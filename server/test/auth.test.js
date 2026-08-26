import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { hashPassword } from "../src/lib/crypto.js";
import { verifyAccessToken } from "../src/lib/jwt.js";
import { env } from "../src/config/env.js";

const runDbTests = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const dbTest = runDbTests ? test : test.skip;
const prefix = `phase3_${Date.now()}`;
let prisma;
let loginStaff;
let refreshStaffSession;
let logoutStaff;
let getCurrentStaff;
let app;
let createApp;

if (runDbTests) {
  ({ prisma } = await import("../src/lib/prisma.js"));
  ({
    loginStaff,
    refreshStaffSession,
    logoutStaff,
    getCurrentStaff,
  } = await import("../src/services/auth.js"));
  ({ createApp } = await import("../src/app.js"));
  app = createApp();
}

async function cleanup() {
  await prisma.staffRefreshToken.deleteMany({});
  await prisma.staffInvitation.deleteMany({});
  await prisma.staffAccount.deleteMany({});
  await prisma.masterAdminRefreshToken.deleteMany({});
  await prisma.masterAdmin.deleteMany({});
  await prisma.auditLog.deleteMany({});
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
      invitedAt: new Date(),
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

function cookieNames(setCookie = []) {
  return setCookie.map((entry) => entry.split(";")[0]);
}

function cookieValue(setCookie = [], name) {
  return cookieNames(setCookie).find((entry) => entry.startsWith(`${name}=`))?.split("=")[1] || "";
}

dbTest("active staff login succeeds and returns RS256 staff access token", async () => {
  const staff = await seedStaff({ email: `${prefix}_active@example.com`, status: "active" });
  const result = await loginStaff(staff.email, "StrongPass123");
  assert.equal(result.staff.id, staff.id);
  const verified = await verifyAccessToken(result.accessToken);
  assert.equal(verified.payload.identityType, "staff");
  assert.equal(verified.payload.typ, "access");
  assert.equal(verified.payload.sub, staff.id);
  assert.equal(await prisma.masterAdminRefreshToken.count(), 0);
});

dbTest("invited, blocked, removed, and wrong-password login fail safely", async () => {
  await seedStaff({ email: `${prefix}_invited@example.com`, status: "invited" });
  await seedStaff({ email: `${prefix}_blocked@example.com`, status: "blocked" });
  await seedStaff({ email: `${prefix}_removed@example.com`, status: "removed" });
  const active = await seedStaff({ email: `${prefix}_wrong@example.com`, status: "active" });

  assert.equal((await loginStaff(`${prefix}_invited@example.com`, "StrongPass123")).status, "generic");
  assert.equal((await loginStaff(`${prefix}_blocked@example.com`, "StrongPass123")).status, "generic");
  assert.equal((await loginStaff(`${prefix}_removed@example.com`, "StrongPass123")).status, "generic");
  assert.equal((await loginStaff(active.email, "WrongPass123")).status, "generic");
});

dbTest("refresh rotation A to B works and stale A retries safely", async () => {
  const staff = await seedStaff({ email: `${prefix}_refresh@example.com`, status: "active" });
  const login = await loginStaff(staff.email, "StrongPass123");
  const first = await refreshStaffSession(login.refreshToken);
  assert.equal(first.accessToken.length > 0, true);
  assert.equal(first.refreshToken.length > 0, true);
  const stale = await refreshStaffSession(login.refreshToken);
  assert.equal(stale.status, "retry");
  assert.equal(await prisma.staffRefreshToken.count(), 2);
});

dbTest("replayed A outside the handoff window fails with 401-equivalent null", async () => {
  const staff = await seedStaff({ email: `${prefix}_outside@example.com`, status: "active" });
  const login = await loginStaff(staff.email, "StrongPass123");
  await refreshStaffSession(login.refreshToken);
  const stored = await prisma.staffRefreshToken.findMany({ where: { staffAccountId: staff.id } });
  const original = stored.find((record) => record.tokenHash);
  await prisma.staffRefreshToken.update({
    where: { id: original.id },
    data: { revokedAt: new Date(Date.now() - 6_000) },
  });
  const stale = await refreshStaffSession(login.refreshToken);
  assert.equal(stale, null);
});

dbTest("logout revokes the refresh session and me reflects current DB truth", async () => {
  const staff = await seedStaff({ email: `${prefix}_logout@example.com`, status: "active" });
  const login = await loginStaff(staff.email, "StrongPass123");
  await logoutStaff(login.refreshToken);
  const refreshed = await prisma.staffRefreshToken.findMany({ where: { staffAccountId: staff.id } });
  assert.ok(refreshed.some((record) => record.revokedAt instanceof Date));
  assert.equal(await getCurrentStaff(staff.id).then((value) => value?.email), staff.email);
});

dbTest("invalid access algorithms are rejected", async () => {
  const staff = await seedStaff({ email: `${prefix}_alg@example.com`, status: "active" });
  const token = await new SignJWT({ sub: staff.id, identityType: "staff", typ: "access" })
    .setProtectedHeader({ alg: "HS256", kid: "bad" })
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode("bad-secret"));
  await assert.rejects(() => verifyAccessToken(token));
});

dbTest("route-level login/refresh/logout/me flow preserves cookies and rejects cross-identity access", async () => {
  const staff = await seedStaff({ email: `${prefix}_route@example.com`, status: "active" });
  await seedMasterAdmin({ username: `${prefix}_admin` });

  const loginRes = await request(app)
    .post("/api/staff/auth/login")
    .send({ email: staff.email, password: "StrongPass123" })
    .expect(200);

  assert.equal(loginRes.body.accessToken.length > 0, true);
  assert.equal(loginRes.body.user.email, staff.email);
  assert.match(JSON.stringify(loginRes.headers["set-cookie"] || []), /staffRefreshToken=/);
  assert.match(JSON.stringify(loginRes.headers["set-cookie"] || []), /staffCsrfToken=/);
  assert.doesNotMatch(JSON.stringify(loginRes.headers["set-cookie"] || []), /masterAdminRefreshToken=/);
  assert.doesNotMatch(JSON.stringify(loginRes.headers["set-cookie"] || []), /masterAdminCsrfToken=/);
  assert.match(JSON.stringify(loginRes.headers["set-cookie"] || []), /HttpOnly/i);
  assert.match(JSON.stringify(loginRes.headers["set-cookie"] || []), /Path=\//i);
  assert.match(JSON.stringify(loginRes.headers["set-cookie"] || []), /SameSite=Lax/i);

  const jar = loginRes.headers["set-cookie"];
  const claims = await verifyAccessToken(loginRes.body.accessToken);
  assert.equal(claims.payload.identityType, "staff");
  assert.equal(claims.payload.typ, "access");
  assert.equal(claims.payload.iss, env.JWT_ISSUER);
  assert.equal(claims.payload.aud, env.JWT_AUDIENCE);
  assert.ok(claims.payload.jti);

  await request(app)
    .post("/api/staff/auth/login")
    .send({ email: staff.email, password: "WrongPass123" })
    .expect(401);

  await request(app)
    .post("/api/staff/auth/login")
    .send({ email: `${prefix}_invited-route@example.com`, password: "StrongPass123" })
    .expect(401);

  await seedStaff({ email: `${prefix}_blocked-route@example.com`, status: "blocked" });
  await seedStaff({ email: `${prefix}_removed-route@example.com`, status: "removed" });

  await request(app)
    .post("/api/staff/auth/login")
    .send({ email: `${prefix}_blocked-route@example.com`, password: "StrongPass123" })
    .expect(401);
  await request(app)
    .post("/api/staff/auth/login")
    .send({ email: `${prefix}_removed-route@example.com`, password: "StrongPass123" })
    .expect(401);

  await request(app)
    .post("/api/staff/auth/refresh")
    .expect(401);

  const refreshRes = await request(app)
    .post("/api/staff/auth/refresh")
    .set("Cookie", jar)
    .expect(200);

  assert.equal(refreshRes.body.user.id, staff.id);
  assert.equal(refreshRes.body.accessToken.length > 0, true);
  assert.match(JSON.stringify(refreshRes.headers["set-cookie"] || []), /staffRefreshToken=/);
  assert.match(JSON.stringify(refreshRes.headers["set-cookie"] || []), /staffCsrfToken=/);
  assert.doesNotMatch(JSON.stringify(refreshRes.headers["set-cookie"] || []), /masterAdminRefreshToken=/);

  const retryRes = await request(app)
    .post("/api/staff/auth/refresh")
    .set("Cookie", jar)
    .expect(409);
  assert.equal(retryRes.body.message, "REFRESH_RETRY");
  assert.equal(retryRes.body.accessToken, undefined);

  const meRes = await request(app)
    .get("/api/staff/auth/me")
    .set("Authorization", `Bearer ${refreshRes.body.accessToken}`)
    .expect(200);
  assert.equal(meRes.body.user.email, staff.email);
  assert.equal(meRes.body.user.status, "active");

  await prisma.staffAccount.update({ where: { id: staff.id }, data: { status: "blocked", blockedAt: new Date() } });
  await request(app)
    .get("/api/staff/auth/me")
    .set("Authorization", `Bearer ${refreshRes.body.accessToken}`)
    .expect(401);

  const logoutRes = await request(app)
    .post("/api/staff/auth/logout")
    .set("x-csrf-token", cookieValue(refreshRes.headers["set-cookie"], "staffCsrfToken"))
    .set("Cookie", refreshRes.headers["set-cookie"])
    .expect(200);
  assert.equal(logoutRes.body.ok, true);
  await request(app)
    .post("/api/staff/auth/logout")
    .set("Cookie", refreshRes.headers["set-cookie"])
    .expect(403);

  await request(app)
    .post("/api/staff/auth/refresh")
    .set("Cookie", refreshRes.headers["set-cookie"])
    .expect(401);

  const jwks = await request(app).get("/api/.well-known/jwks.json").expect(200);
  assert.equal(Array.isArray(jwks.body.keys), true);
  assert.ok(jwks.body.keys.every((key) => key.kty && key.n && key.e && key.use === "sig" && key.alg === "RS256" && key.kid));

  const masterAdminCount = await prisma.masterAdminRefreshToken.count();
  assert.equal(masterAdminCount, 0);
});

dbTest("staff change password requires csrf, rotates credentials, and revokes old refresh sessions", async () => {
  const staff = await seedStaff({ email: `${prefix}_password@example.com`, status: "active" });
  const loginRes = await request(app)
    .post("/api/staff/auth/login")
    .send({ email: staff.email, password: "StrongPass123" })
    .expect(200);

  await request(app)
    .post("/api/user/change-password")
    .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
    .set("Cookie", loginRes.headers["set-cookie"])
    .send({
      currentPassword: "StrongPass123",
      newPassword: "NewStrongPass123!",
      repeatNewPassword: "NewStrongPass123!",
    })
    .expect(403);

  await request(app)
    .post("/api/user/change-password")
    .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
    .set("x-csrf-token", cookieValue(loginRes.headers["set-cookie"], "staffCsrfToken"))
    .set("Cookie", loginRes.headers["set-cookie"])
    .send({
      currentPassword: "WrongPass123",
      newPassword: "NewStrongPass123!",
      repeatNewPassword: "NewStrongPass123!",
    })
    .expect(400)
    .expect((res) => {
      assert.equal(res.body.message, "Current password is incorrect.");
    });

  await request(app)
    .post("/api/user/change-password")
    .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
    .set("x-csrf-token", cookieValue(loginRes.headers["set-cookie"], "staffCsrfToken"))
    .set("Cookie", loginRes.headers["set-cookie"])
    .send({
      currentPassword: "StrongPass123",
      newPassword: "NewStrongPass123!",
      repeatNewPassword: "NewStrongPass123!",
    })
    .expect(200)
    .expect((res) => {
      assert.equal(res.body.ok, true);
      assert.equal(res.body.message, "Password changed successfully.");
    });

  await request(app)
    .post("/api/staff/auth/login")
    .send({ email: staff.email, password: "StrongPass123" })
    .expect(401);

  const relogin = await request(app)
    .post("/api/staff/auth/login")
    .send({ email: staff.email, password: "NewStrongPass123!" })
    .expect(200);
  assert.equal(relogin.body.user.email, staff.email);

  await request(app)
    .post("/api/staff/auth/refresh")
    .set("Cookie", loginRes.headers["set-cookie"])
    .expect(401);
});

dbTest("master admin login/refresh/logout/me flow uses its own cookie namespace", async () => {
  const masterAdmin = await seedMasterAdmin({ username: `${prefix}_master` });

  const loginRes = await request(app)
    .post("/api/master-admin/auth/login")
    .send({ username: masterAdmin.username, password: "MasterPass123" })
    .expect(200);

  assert.equal(loginRes.body.accessToken.length > 0, true);
  assert.equal(loginRes.body.user.username, masterAdmin.username);
  assert.match(JSON.stringify(loginRes.headers["set-cookie"] || []), /masterAdminRefreshToken=/);
  assert.match(JSON.stringify(loginRes.headers["set-cookie"] || []), /masterAdminCsrfToken=/);
  assert.doesNotMatch(JSON.stringify(loginRes.headers["set-cookie"] || []), /staffRefreshToken=/);
  assert.doesNotMatch(JSON.stringify(loginRes.headers["set-cookie"] || []), /staffCsrfToken=/);

  const cookieJar = loginRes.headers["set-cookie"];
  const refreshRes = await request(app)
    .post("/api/master-admin/auth/refresh")
    .set("Cookie", cookieJar)
    .expect(200);
  assert.equal(refreshRes.body.user.id, masterAdmin.id);
  assert.equal(refreshRes.body.user.username, masterAdmin.username);
  assert.match(JSON.stringify(refreshRes.headers["set-cookie"] || []), /masterAdminRefreshToken=/);
  assert.match(JSON.stringify(refreshRes.headers["set-cookie"] || []), /masterAdminCsrfToken=/);

  const retryRes = await request(app)
    .post("/api/master-admin/auth/refresh")
    .set("Cookie", cookieJar)
    .expect(409);
  assert.equal(retryRes.body.message, "REFRESH_RETRY");

  const meRes = await request(app)
    .get("/api/master-admin/auth/me")
    .set("Authorization", `Bearer ${refreshRes.body.accessToken}`)
    .expect(200);
  assert.equal(meRes.body.user.username, masterAdmin.username);

  const auditRes = await request(app)
    .get("/api/admin/audit-logs")
    .set("Authorization", `Bearer ${refreshRes.body.accessToken}`)
    .expect(200);
  assert.equal(Array.isArray(auditRes.body.auditLogs), true);
  assert.equal(typeof auditRes.body.total, "number");

  await request(app)
    .post("/api/master-admin/auth/logout")
    .set("x-csrf-token", cookieValue(refreshRes.headers["set-cookie"], "masterAdminCsrfToken"))
    .set("Cookie", refreshRes.headers["set-cookie"])
    .expect(200);

  await request(app)
    .post("/api/master-admin/auth/refresh")
    .set("Cookie", refreshRes.headers["set-cookie"])
    .expect(401);
});

dbTest("staff and master admin cookie pairs can coexist without overwriting each other", async () => {
  const staff = await seedStaff({ email: `${prefix}_coexist@example.com`, status: "active" });
  const masterAdmin = await seedMasterAdmin({ username: `${prefix}_coexist_admin` });

  const staffLogin = await request(app)
    .post("/api/staff/auth/login")
    .send({ email: staff.email, password: "StrongPass123" })
    .expect(200);

  const adminLogin = await request(app)
    .post("/api/master-admin/auth/login")
    .send({ username: masterAdmin.username, password: "MasterPass123" })
    .expect(200);

  const combinedJar = [...staffLogin.headers["set-cookie"], ...adminLogin.headers["set-cookie"]];

  const staffRefresh = await request(app)
    .post("/api/staff/auth/refresh")
    .set("Cookie", combinedJar)
    .expect(200);
  const adminRefresh = await request(app)
    .post("/api/master-admin/auth/refresh")
    .set("Cookie", combinedJar)
    .expect(200);
  const rotatedJar = [...staffRefresh.headers["set-cookie"], ...adminRefresh.headers["set-cookie"]];

  assert.equal(staffRefresh.body.user.email, staff.email);
  assert.equal(adminRefresh.body.user.username, masterAdmin.username);
  assert.match(JSON.stringify(combinedJar), /staffRefreshToken=/);
  assert.match(JSON.stringify(combinedJar), /staffCsrfToken=/);
  assert.match(JSON.stringify(combinedJar), /masterAdminRefreshToken=/);
  assert.match(JSON.stringify(combinedJar), /masterAdminCsrfToken=/);

  const staffLogout = await request(app)
    .post("/api/staff/auth/logout")
    .set("x-csrf-token", cookieValue(staffRefresh.headers["set-cookie"], "staffCsrfToken"))
    .set("Cookie", rotatedJar)
    .expect(200);
  const staffLogoutCookies = JSON.stringify(staffLogout.headers["set-cookie"] || []);
  assert.match(staffLogoutCookies, /staffRefreshToken=/);
  assert.match(staffLogoutCookies, /staffCsrfToken=/);
  assert.doesNotMatch(staffLogoutCookies, /masterAdminRefreshToken=/);
  assert.doesNotMatch(staffLogoutCookies, /masterAdminCsrfToken=/);

  const adminLogout = await request(app)
    .post("/api/master-admin/auth/logout")
    .set("x-csrf-token", cookieValue(adminRefresh.headers["set-cookie"], "masterAdminCsrfToken"))
    .set("Cookie", rotatedJar)
    .expect(200);
  const adminLogoutCookies = JSON.stringify(adminLogout.headers["set-cookie"] || []);
  assert.match(adminLogoutCookies, /masterAdminRefreshToken=/);
  assert.match(adminLogoutCookies, /masterAdminCsrfToken=/);
  assert.doesNotMatch(adminLogoutCookies, /staffRefreshToken=/);
  assert.doesNotMatch(adminLogoutCookies, /staffCsrfToken=/);
});

dbTest("cross-domain csrf cookies cannot satisfy the other domain", async () => {
  const staff = await seedStaff({ email: `${prefix}_csrf@example.com`, status: "active" });
  const masterAdmin = await seedMasterAdmin({ username: `${prefix}_csrf_admin` });

  const staffLogin = await request(app)
    .post("/api/staff/auth/login")
    .send({ email: staff.email, password: "StrongPass123" })
    .expect(200);

  const adminLogin = await request(app)
    .post("/api/master-admin/auth/login")
    .send({ username: masterAdmin.username, password: "MasterPass123" })
    .expect(200);

  await request(app)
    .post("/api/staff/auth/logout")
    .set("x-csrf-token", cookieValue(adminLogin.headers["set-cookie"], "masterAdminCsrfToken"))
    .set("Cookie", staffLogin.headers["set-cookie"])
    .expect(403);

  await request(app)
    .post("/api/master-admin/auth/logout")
    .set("x-csrf-token", cookieValue(staffLogin.headers["set-cookie"], "staffCsrfToken"))
    .set("Cookie", adminLogin.headers["set-cookie"])
    .expect(403);
});

dbTest("concurrent replay of refresh A yields one successor and one retry with exact DB state", async () => {
  const staff = await seedStaff({ email: `${prefix}_concurrent@example.com`, status: "active" });
  const loginRes = await request(app)
    .post("/api/staff/auth/login")
    .send({ email: staff.email, password: "StrongPass123" })
    .expect(200);
  const cookieJar = loginRes.headers["set-cookie"];

  const [first, second] = await Promise.all([
    request(app).post("/api/staff/auth/refresh").set("Cookie", cookieJar),
    request(app).post("/api/staff/auth/refresh").set("Cookie", cookieJar),
  ]);

  const statuses = [first.statusCode, second.statusCode].sort();
  assert.deepEqual(statuses, [200, 409]);
  const okResponse = first.statusCode === 200 ? first : second;
  const retryResponse = first.statusCode === 409 ? first : second;
  assert.equal(retryResponse.body.message, "REFRESH_RETRY");
  assert.equal(retryResponse.body.accessToken, undefined);
  assert.equal(retryResponse.body.refreshToken, undefined);

  const records = await prisma.staffRefreshToken.findMany({ where: { staffAccountId: staff.id } });
  assert.equal(records.length, 2);
  assert.equal(records.filter((record) => record.revokedAt === null).length, 1);
  assert.equal(records.filter((record) => record.revokedAt instanceof Date).length, 1);
  const successor = records.find((record) => record.revokedAt === null);
  assert.ok(successor);
  assert.equal(okResponse.body.accessToken.length > 0, true);
  assert.equal(records.some((record) => record.replacedByTokenId === successor.id), true);
});
