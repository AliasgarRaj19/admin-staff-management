import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../src/lib/crypto.js";
import { signAccessToken } from "../src/lib/jwt.js";

const runDbTests = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const dbTest = runDbTests ? test : test.skip;

let prisma;
let app;

if (runDbTests) {
  ({ prisma } = await import("../src/lib/prisma.js"));
  const { createApp } = await import("../src/app.js");
  app = createApp();
}

async function cleanup() {
  await prisma.auditLog.deleteMany({});
  await prisma.staffRefreshToken.deleteMany({});
  await prisma.staffInvitation.deleteMany({});
  await prisma.staffPasswordReset.deleteMany({});
  await prisma.staffAccount.deleteMany({});
  await prisma.masterAdminRefreshToken.deleteMany({});
  await prisma.masterAdmin.deleteMany({});
}

beforeEach(async () => {
  if (!runDbTests) return;
  await cleanup();
});

after(async () => {
  if (runDbTests && prisma.$disconnect) await prisma.$disconnect();
});

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

async function seedMasterAdmin({ username }) {
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

async function loginStaffViaRoute(email, password) {
  return request(app)
    .post("/api/staff/auth/login")
    .send({ email, password })
    .expect(200);
}

async function createMasterAdminToken(masterAdmin) {
  return signAccessToken({
    sub: masterAdmin.id,
    identityType: "master_admin",
    tokenType: "access",
  });
}

async function loginLifecycleActor() {
  const actor = await seedMasterAdmin({ username: `master_${Date.now()}` });
  const accessToken = await createMasterAdminToken(actor);
  return { actor, accessToken };
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

dbTest("staff lifecycle lists active, blocked, and removed staff with safe fields", async () => {
  const { accessToken } = await loginLifecycleActor();
  const active = await seedStaff({ email: `active_${Date.now()}@example.com`, status: "active", roleName: "Sales Manager" });
  const blocked = await seedStaff({ email: `blocked_${Date.now()}@example.com`, status: "blocked", roleName: "Support Lead" });
  const removed = await seedStaff({ email: `removed_${Date.now()}@example.com`, status: "removed", roleName: "HR Executive" });

  for (const status of ["active", "blocked", "removed"]) {
    const res = await request(app)
      .get("/api/admin/staff")
      .query({ status })
      .set(authHeaders(accessToken))
      .expect(200);
    assert.equal(res.body.staff.every((staff) => staff.status === status), true);
    assert.ok(res.body.staff.every((staff) => staff.passwordHash === undefined && staff.tokenHash === undefined));
  }

  const detail = await request(app)
    .get(`/api/admin/staff/${active.id}`)
    .set(authHeaders(accessToken))
    .expect(200);
  assert.equal(detail.body.staff.email, active.email);
  assert.equal(detail.body.staff.roleName, "Sales Manager");
  assert.equal(detail.body.staff.passwordHash, undefined);
  assert.equal(detail.body.staff.tokenHash, undefined);

  await request(app)
    .get(`/api/admin/staff/${removed.id}`)
    .set(authHeaders(accessToken))
    .expect(200);

  const masterAdmin = await seedMasterAdmin({ username: `master_lookup_${Date.now()}` });
  await request(app)
    .get(`/api/admin/staff/${masterAdmin.id}`)
    .set(authHeaders(accessToken))
    .expect(404);
});

dbTest("blocking active staff revokes refresh sessions and invalidates the current access JWT", async () => {
  const { accessToken } = await loginLifecycleActor();
  const target = await seedStaff({ email: `target_${Date.now()}@example.com`, status: "active", roleName: "Content Manager" });
  const targetLogin = await loginStaffViaRoute(target.email, "StrongPass123");
  const masterAdmin = await seedMasterAdmin({ username: `master_session_${Date.now()}` });
  const masterRefreshToken = await prisma.masterAdminRefreshToken.create({
    data: {
      id: randomUUID(),
      masterAdminId: masterAdmin.id,
      tokenHash: "master-refresh-hash",
      jti: randomUUID(),
      familyId: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      replacedByTokenId: null,
      createdAt: new Date(),
    },
  });

  const beforeCount = await prisma.masterAdminRefreshToken.count();
  const block = await request(app)
    .post(`/api/admin/staff/${target.id}/block`)
    .set(authHeaders(accessToken))
    .expect(200);
  assert.equal(block.body.staff.status, "blocked");
  assert.ok(block.body.staff.blockedAt);
  assert.equal(block.body.staff.removedAt, null);

  await request(app)
    .get("/api/staff/auth/me")
    .set(authHeaders(targetLogin.body.accessToken))
    .expect(401);

  await request(app)
    .post("/api/staff/auth/login")
    .send({ email: target.email, password: "StrongPass123" })
    .expect(401);

  await request(app)
    .post("/api/staff/auth/refresh")
    .set("Cookie", targetLogin.headers["set-cookie"])
    .expect(401);

  const targetRefreshRows = await prisma.staffRefreshToken.findMany({ where: { staffAccountId: target.id } });
  assert.equal(targetRefreshRows.length, 1);
  assert.equal(targetRefreshRows.every((row) => row.revokedAt instanceof Date), true);
  assert.equal(await prisma.masterAdminRefreshToken.count(), beforeCount);
  assert.equal(masterRefreshToken.masterAdminId, masterAdmin.id);

  await request(app)
    .post(`/api/admin/staff/${target.id}/block`)
    .set(authHeaders(accessToken))
    .expect(409);
});

dbTest("unblocking and restoring require fresh login and keep old sessions revoked", async () => {
  const { accessToken } = await loginLifecycleActor();
  const target = await seedStaff({ email: `transition_${Date.now()}@example.com`, status: "active", roleName: "Support Lead" });
  const targetLogin = await loginStaffViaRoute(target.email, "StrongPass123");

  await request(app)
    .post(`/api/admin/staff/${target.id}/block`)
    .set(authHeaders(accessToken))
    .expect(200);
  await request(app)
    .post(`/api/admin/staff/${target.id}/unblock`)
    .set(authHeaders(accessToken))
    .expect(200);

  const unblocked = await prisma.staffAccount.findUnique({ where: { id: target.id } });
  assert.equal(unblocked.status, "active");
  assert.equal(unblocked.blockedAt, null);

  await request(app)
    .post("/api/staff/auth/refresh")
    .set("Cookie", targetLogin.headers["set-cookie"])
    .expect(401);

  await request(app)
    .post("/api/staff/auth/login")
    .send({ email: target.email, password: "StrongPass123" })
    .expect(200);

  await request(app)
    .post(`/api/admin/staff/${target.id}/remove`)
    .set(authHeaders(accessToken))
    .expect(200);
  await request(app)
    .post(`/api/admin/staff/${target.id}/restore`)
    .set(authHeaders(accessToken))
    .expect(200);

  const restored = await prisma.staffAccount.findUnique({ where: { id: target.id } });
  assert.equal(restored.status, "active");
  assert.equal(restored.removedAt, null);
  assert.equal(restored.blockedAt, null);

  await request(app)
    .post("/api/staff/auth/refresh")
    .set("Cookie", targetLogin.headers["set-cookie"])
    .expect(401);

  await request(app)
    .post("/api/staff/auth/login")
    .send({ email: target.email, password: "StrongPass123" })
    .expect(200);
});

dbTest("remove and permanent delete enforce state and confirmation rules", async () => {
  const { accessToken } = await loginLifecycleActor();
  const activeTarget = await seedStaff({ email: `remove_${Date.now()}@example.com`, status: "active", roleName: "Sales Manager" });
  const blockedTarget = await seedStaff({ email: `blocked_remove_${Date.now()}@example.com`, status: "blocked", roleName: "HR Executive" });
  const removedTarget = await seedStaff({ email: `deleted_${Date.now()}@example.com`, status: "removed", roleName: "Support Lead" });
  const activeDirectTarget = await seedStaff({ email: `active_delete_${Date.now()}@example.com`, status: "active", roleName: "Sales Manager" });
  const activeTargetLogin = await loginStaffViaRoute(activeTarget.email, "StrongPass123");

  await request(app)
    .post(`/api/admin/staff/${activeTarget.id}/remove`)
    .set(authHeaders(accessToken))
    .expect(200);

  await request(app)
    .post(`/api/admin/staff/${blockedTarget.id}/remove`)
    .set(authHeaders(accessToken))
    .expect(200);

  await request(app)
    .post(`/api/admin/staff/${activeTarget.id}/remove`)
    .set(authHeaders(accessToken))
    .expect(409);

  await request(app)
    .delete(`/api/admin/staff/${removedTarget.id}`)
    .set(authHeaders(accessToken))
    .expect(400);

  await request(app)
    .delete(`/api/admin/staff/${activeDirectTarget.id}`)
    .set(authHeaders(accessToken))
    .send({ confirm: "DELETE" })
    .expect(409);

  await request(app)
    .post(`/api/admin/staff/${activeTarget.id}/restore`)
    .set(authHeaders(accessToken))
    .expect(200);

  await request(app)
    .post("/api/staff/auth/login")
    .send({ email: activeTarget.email, password: "StrongPass123" })
    .expect(200);
  await request(app)
    .post("/api/staff/auth/refresh")
    .set("Cookie", activeTargetLogin.headers["set-cookie"])
    .expect(401);

  await request(app)
    .post(`/api/admin/staff/${activeTarget.id}/remove`)
    .set(authHeaders(accessToken))
    .expect(200);

  await request(app)
    .post(`/api/admin/staff/${removedTarget.id}/remove`)
    .set(authHeaders(accessToken))
    .expect(409);

  await request(app)
    .delete(`/api/admin/staff/${activeTarget.id}`)
    .set(authHeaders(accessToken))
    .send({ confirm: "DELETE" })
    .expect(204);

  await request(app)
    .delete(`/api/admin/staff/${blockedTarget.id}`)
    .set(authHeaders(accessToken))
    .send({ confirm: "DELETE" })
    .expect(204);

  await request(app)
    .delete(`/api/admin/staff/${removedTarget.id}`)
    .set(authHeaders(accessToken))
    .send({ confirm: "DELETE" })
    .expect(204);

  const deleted = await prisma.staffAccount.findUnique({ where: { id: activeTarget.id } });
  assert.equal(deleted, null);
  assert.equal(await prisma.staffRefreshToken.count({ where: { staffAccountId: activeTarget.id } }), 0);
  const auditRows = await prisma.auditLog.findMany({ where: { action: "staff.lifecycle.permanent_deleted", resourceId: activeTarget.id } });
  assert.ok(auditRows.length > 0);
  assert.doesNotMatch(JSON.stringify(auditRows), /passwordHash|tokenHash|refreshToken|secret/i);
  assert.equal(await prisma.masterAdmin.count(), 1);

  await request(app)
    .delete(`/api/admin/staff/${activeTarget.id}`)
    .set(authHeaders(accessToken))
    .send({ confirm: "DELETE" })
    .expect(404);

  const staffJwt = await signAccessToken({
    sub: activeTarget.id,
    identityType: "staff",
    tokenType: "access",
    roleName: "Sales Manager",
  });
  await request(app)
    .delete(`/api/admin/staff/${removedTarget.id}`)
    .set(authHeaders(staffJwt))
    .send({ confirm: "DELETE" })
    .expect(401);
});

dbTest("concurrent block requests remain deterministic and do not corrupt state", async () => {
  const { accessToken } = await loginLifecycleActor();
  const target = await seedStaff({ email: `concurrent_${Date.now()}@example.com`, status: "active", roleName: "Content Manager" });

  const [first, second] = await Promise.all([
    request(app).post(`/api/admin/staff/${target.id}/block`).set(authHeaders(accessToken)),
    request(app).post(`/api/admin/staff/${target.id}/block`).set(authHeaders(accessToken)),
  ]);

  const statuses = [first.statusCode, second.statusCode].sort();
  assert.deepEqual(statuses, [200, 409]);

  const blocked = await prisma.staffAccount.findUnique({ where: { id: target.id } });
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.blockedAt);
  assert.equal(await prisma.staffRefreshToken.count({ where: { staffAccountId: target.id, revokedAt: null } }), 0);
});

dbTest("lifecycle routes reject non-admin staff accounts", async () => {
  const staff = await seedStaff({ email: `plain_${Date.now()}@example.com`, status: "active", roleName: "MasterAdmin" });
  const login = await loginStaffViaRoute(staff.email, "StrongPass123");
  const target = await seedStaff({ email: `target_plain_${Date.now()}@example.com`, status: "active" });

  await request(app)
    .post(`/api/admin/staff/${target.id}/block`)
    .set(authHeaders(login.body.accessToken))
    .expect(401);
});
