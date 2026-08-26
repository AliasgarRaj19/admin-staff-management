import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { canonicalPermissionSeeds } from "../src/domain/permissionSeeds.js";
import { normalizeRbacRoleName } from "../src/domain/rbac.js";
import { hashPassword } from "../src/lib/password.js";
import { signAccessToken } from "../src/lib/jwt.js";

const runDbTests = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const dbTest = runDbTests ? test : test.skip;
let prisma;
let app;
let getPermissionRegistry;
let getEffectivePermissions;

if (runDbTests) {
  ({ prisma } = await import("../src/lib/prisma.js"));
  ({ getPermissionRegistry, getEffectivePermissions } = await import("../src/services/rbac.js"));
  const { createApp } = await import("../src/app.js");
  app = createApp();
}

async function cleanup() {
  await prisma.auditLog.deleteMany({});
  await prisma.staffPermission.deleteMany({});
  await prisma.staffRole.deleteMany({});
  await prisma.rolePermission.deleteMany({});
  await prisma.role.deleteMany({});
  await prisma.staffRefreshToken.deleteMany({});
  await prisma.staffInvitation.deleteMany({});
  await prisma.staffPasswordReset.deleteMany({});
  await prisma.staffAccount.deleteMany({});
  await prisma.masterAdminRefreshToken.deleteMany({});
  await prisma.masterAdmin.deleteMany({});
  await prisma.permission.createMany({ data: canonicalPermissionSeeds, skipDuplicates: true });
}

beforeEach(async () => {
  if (!runDbTests) return;
  await cleanup();
});

after(async () => {
  if (runDbTests && prisma.$disconnect) await prisma.$disconnect();
});

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function seedMasterAdmin(username = `master_${Date.now()}`) {
  return prisma.masterAdmin.create({
    data: {
      id: randomUUID(),
      username,
      email: `${username}@example.com`,
      passwordHash: await hashPassword("MasterPass123"),
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createMasterAdminToken(masterAdmin) {
  return signAccessToken({
    sub: masterAdmin.id,
    identityType: "master_admin",
    tokenType: "access",
  });
}

async function seedStaff({ email, status = "active", password = "StrongPass123", roleName = "Moderator" }) {
  const passwordHash = status === "active" ? await hashPassword(password) : null;
  return prisma.staffAccount.create({
    data: {
      id: randomUUID(),
      email,
      passwordHash,
      roleName,
      status,
      firstName: status === "active" ? "Ada" : null,
      lastName: status === "active" ? "Lovelace" : null,
      phone: null,
      invitedAt: status === "invited" ? new Date() : null,
      registeredAt: status === "active" ? new Date() : null,
      activatedAt: status === "active" ? new Date() : null,
      blockedAt: status === "blocked" ? new Date() : null,
      removedAt: status === "removed" ? new Date() : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

dbTest("permission registry is seeded and grouped by module", async () => {
  const registry = await getPermissionRegistry();
  assert.equal(registry.count, 33);
  assert.equal(registry.permissions.length, 33);
  assert.ok(Array.isArray(registry.groups.staff));
  assert.ok(Array.isArray(registry.groups.pages));
  assert.ok(registry.groups.staff.some((permission) => permission.key === "staff.manage"));
  assert.ok(registry.groups.permissions.some((permission) => permission.key === "permissions.manage"));
});

dbTest("permission seed is idempotent", async () => {
  await prisma.permission.createMany({ data: canonicalPermissionSeeds, skipDuplicates: true });
  await prisma.permission.createMany({ data: canonicalPermissionSeeds, skipDuplicates: true });
  assert.equal(await prisma.permission.count(), 33);
});

dbTest("role CRUD, permission replacement, and deletion safety work", async () => {
  const masterAdmin = await seedMasterAdmin();
  const token = await createMasterAdminToken(masterAdmin);
  const create = await request(app)
    .post("/api/admin/roles")
    .set(authHeaders(token))
    .send({ name: "Content Team", description: "Editors", permissionKeys: ["pages.read", "pages.edit"] })
    .expect(201);
  assert.equal(create.body.role.name, "Content Team");
  assert.deepEqual(create.body.role.permissionKeys, ["pages.edit", "pages.read"]);

  await request(app)
    .post("/api/admin/roles")
    .set(authHeaders(token))
    .send({ name: "  Content Team  " })
    .expect(409);

  const roleId = create.body.role.id;
  const update = await request(app)
    .patch(`/api/admin/roles/${roleId}`)
    .set(authHeaders(token))
    .send({ name: "Editorial Team", description: "Updated" })
    .expect(200);
  assert.equal(update.body.role.name, "Editorial Team");
  assert.deepEqual(update.body.role.permissionKeys, ["pages.edit", "pages.read"]);

  const updatedPermissions = await request(app)
    .put(`/api/admin/roles/${roleId}/permissions`)
    .set(authHeaders(token))
    .send({ permissionKeys: ["pages.read"] })
    .expect(200);
  assert.deepEqual(updatedPermissions.body.role.permissionKeys, ["pages.read"]);

  const other = await request(app)
    .post("/api/admin/roles")
    .set(authHeaders(token))
    .send({ name: "Support Team" })
    .expect(201);
  const staff = await seedStaff({ email: `assigned_${Date.now()}@example.com`, status: "active" });
  await prisma.staffRole.create({ data: { staffAccountId: staff.id, roleId: other.body.role.id, createdAt: new Date() } });

  await request(app)
    .delete(`/api/admin/roles/${other.body.role.id}`)
    .set(authHeaders(token))
    .expect(409);

  await prisma.staffRole.deleteMany({ where: { staffAccountId: staff.id, roleId: other.body.role.id } });
  await request(app)
    .delete(`/api/admin/roles/${other.body.role.id}`)
    .set(authHeaders(token))
    .expect(204);

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  assert.equal(role.name, "Editorial Team");
  const auditRows = await prisma.auditLog.findMany({ where: { OR: [{ action: "permissions.role.created" }, { action: "permissions.role.updated" }, { action: "permissions.role.deleted" }] } });
  assert.ok(auditRows.length >= 3);
  assert.doesNotMatch(JSON.stringify(auditRows), /tokenHash|passwordHash|refreshToken|secret/i);
});

dbTest("staff roles, direct permissions, and effective permissions use live DB truth", async () => {
  const masterAdmin = await seedMasterAdmin();
  const token = await createMasterAdminToken(masterAdmin);
  const role = await request(app)
    .post("/api/admin/roles")
    .set(authHeaders(token))
    .send({ name: "Pages Viewer", permissionKeys: ["pages.read"] })
    .expect(201);
  const staff = await seedStaff({ email: `staff_${Date.now()}@example.com`, status: "active" });
  const staffToken = await signAccessToken({ sub: staff.id, identityType: "staff", tokenType: "access" });

  await request(app)
    .put(`/api/admin/staff/${staff.id}/roles`)
    .set(authHeaders(token))
    .send({ roleIds: [role.body.role.id] })
    .expect(200);

  const roles = await request(app)
    .get(`/api/admin/staff/${staff.id}/roles`)
    .set(authHeaders(token))
    .expect(200);
  assert.equal(roles.body.roles.length, 1);
  assert.equal(roles.body.roles[0].name, "Pages Viewer");

  await request(app)
    .put(`/api/admin/staff/${staff.id}/permissions`)
    .set(authHeaders(token))
    .send({ permissionKeys: ["pages.edit"] })
    .expect(200);

  const permissions = await request(app)
    .get(`/api/admin/staff/${staff.id}/permissions`)
    .set(authHeaders(token))
    .expect(200);
  assert.deepEqual(permissions.body.permissions.map((permission) => permission.key), ["pages.edit"]);

  const effective = await request(app)
    .get(`/api/admin/staff/${staff.id}/effective-permissions`)
    .set(authHeaders(token))
    .expect(200);
  assert.deepEqual(effective.body.permissions.map((permission) => permission.key), ["pages.edit", "pages.read"]);

  await request(app)
    .get("/api/staff/access-check/pages")
    .set(authHeaders(staffToken))
    .expect(200);
  await request(app)
    .get("/api/staff/access-check/pages/edit")
    .set(authHeaders(staffToken))
    .expect(200);
  await request(app)
    .get("/api/staff/access-check/pages.read")
    .set(authHeaders(staffToken))
    .expect(200);
  await request(app)
    .get("/api/staff/access-check/pages/create")
    .set(authHeaders(staffToken))
    .expect(403);

  const zeroPerm = await seedStaff({ email: `zero_${Date.now()}@example.com`, status: "active" });
  const zeroToken = await signAccessToken({ sub: zeroPerm.id, identityType: "staff", tokenType: "access" });
  await request(app)
    .get("/api/staff/access-check/pages")
    .set(authHeaders(zeroToken))
    .expect(403);

  const auditRows = await prisma.auditLog.findMany({ where: { action: "permissions.staff.direct_permissions_updated" } });
  assert.ok(auditRows.length >= 1);
  assert.doesNotMatch(JSON.stringify(auditRows), /tokenHash|passwordHash|refreshToken|secret/i);
});

dbTest("permission revocation and role unassignment deny on the next request", async () => {
  const masterAdmin = await seedMasterAdmin();
  const token = await createMasterAdminToken(masterAdmin);
  const role = await request(app)
    .post("/api/admin/roles")
    .set(authHeaders(token))
    .send({ name: "Editors", permissionKeys: ["pages.read"] })
    .expect(201);
  const staff = await seedStaff({ email: `revocation_${Date.now()}@example.com`, status: "active" });
  const staffToken = await signAccessToken({ sub: staff.id, identityType: "staff", tokenType: "access" });

  await request(app)
    .put(`/api/admin/staff/${staff.id}/roles`)
    .set(authHeaders(token))
    .send({ roleIds: [role.body.role.id] })
    .expect(200);
  await request(app)
    .get("/api/staff/access-check/pages")
    .set(authHeaders(staffToken))
    .expect(200);

  await request(app)
    .put(`/api/admin/roles/${role.body.role.id}/permissions`)
    .set(authHeaders(token))
    .send({ permissionKeys: [] })
    .expect(200);
  await request(app)
    .get("/api/staff/access-check/pages")
    .set(authHeaders(staffToken))
    .expect(403);

  await request(app)
    .put(`/api/admin/staff/${staff.id}/permissions`)
    .set(authHeaders(token))
    .send({ permissionKeys: ["pages.edit"] })
    .expect(200);
  await request(app)
    .get("/api/staff/access-check/pages/edit")
    .set(authHeaders(staffToken))
    .expect(200);

  await request(app)
    .put(`/api/admin/staff/${staff.id}/permissions`)
    .set(authHeaders(token))
    .send({ permissionKeys: [] })
    .expect(200);
  await request(app)
    .get("/api/staff/access-check/pages/edit")
    .set(authHeaders(staffToken))
    .expect(403);

  await request(app)
    .put(`/api/admin/staff/${staff.id}/roles`)
    .set(authHeaders(token))
    .send({ roleIds: [] })
    .expect(200);
  await request(app)
    .get("/api/staff/access-check/pages")
    .set(authHeaders(staffToken))
    .expect(403);
});

dbTest("route-level authorization stays separated from MasterAdmin identity", async () => {
  const masterAdmin = await seedMasterAdmin();
  const masterToken = await createMasterAdminToken(masterAdmin);
  const staff = await seedStaff({ email: `plain_${Date.now()}@example.com`, status: "active", roleName: "MasterAdmin" });
  const staffToken = await signAccessToken({ sub: staff.id, identityType: "staff", tokenType: "access" });
  const blocked = await seedStaff({ email: `blocked_${Date.now()}@example.com`, status: "blocked" });
  const blockedToken = await signAccessToken({ sub: blocked.id, identityType: "staff", tokenType: "access" });

  await request(app)
    .get("/api/admin/permissions")
    .set(authHeaders(staffToken))
    .expect(401);

  await request(app)
    .get("/api/admin/permissions")
    .set(authHeaders(masterToken))
    .expect(200);

  await request(app)
    .get("/api/staff/access-check/pages")
    .set(authHeaders(blockedToken))
    .expect(401);

  const masterRoles = await prisma.staffRole.findMany({ where: { staffAccountId: masterAdmin.id } });
  const masterPermissions = await prisma.staffPermission.findMany({ where: { staffAccountId: masterAdmin.id } });
  assert.equal(masterRoles.length, 0);
  assert.equal(masterPermissions.length, 0);
  assert.deepEqual(await getEffectivePermissions(masterAdmin.id), []);
});

dbTest("role and permission updates are transaction-safe under concurrent requests", async () => {
  const masterAdmin = await seedMasterAdmin();
  const token = await createMasterAdminToken(masterAdmin);
  const role = await request(app)
    .post("/api/admin/roles")
    .set(authHeaders(token))
    .send({ name: "Concurrent Editors" })
    .expect(201);

  const [first, second] = await Promise.all([
    request(app)
      .put(`/api/admin/roles/${role.body.role.id}/permissions`)
      .set(authHeaders(token))
      .send({ permissionKeys: ["pages.read", "pages.edit"] }),
    request(app)
      .put(`/api/admin/roles/${role.body.role.id}/permissions`)
      .set(authHeaders(token))
      .send({ permissionKeys: ["pages.read", "pages.edit"] }),
  ]);

  assert.ok([200, 200].includes(first.statusCode));
  assert.ok([200, 200].includes(second.statusCode));

  const rolePermissions = await prisma.rolePermission.findMany({ where: { roleId: role.body.role.id } });
  assert.equal(new Set(rolePermissions.map((row) => row.permissionId)).size, rolePermissions.length);
});

test("role name normalization keeps RBAC roles separate from display designations", () => {
  assert.equal(normalizeRbacRoleName("  Sales Team  "), "Sales Team");
  assert.throws(() => normalizeRbacRoleName("   "), /Role name is required/);
});
