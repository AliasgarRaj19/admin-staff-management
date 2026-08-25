import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createStaffRepository } from "../../src/repositories/staffRepository.js";
import { createInvitation, acceptInvitation, resendInvitation, validateInvitation } from "../../src/services/staffOnboarding.js";
import { hashPassword, verifyPassword } from "../../src/lib/password.js";
import { hashToken } from "../../src/lib/token.js";

const runDbTests = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const dbTest = runDbTests ? test : test.skip;
const now = new Date("2026-08-25T00:00:00Z");
const clientUrl = "https://example.test";
const testPrefix = `phase25_${Date.now()}`;
let prisma;
let repository;

if (runDbTests) {
  ({ prisma } = await import("../../src/lib/prisma.js"));
  repository = createStaffRepository(prisma);
}

async function cleanup(prefix = testPrefix) {
  await prisma.auditLog.deleteMany({});
  await prisma.staffInvitation.deleteMany({});
  await prisma.staffRefreshToken.deleteMany({});
  await prisma.staffAccount.deleteMany({});
  await prisma.masterAdminRefreshToken.deleteMany({});
  await prisma.masterAdmin.deleteMany({});
}

after(async () => {
  if (runDbTests) {
    await prisma.$disconnect();
  }
});

dbTest("real DB invitation acceptance and audit trail", async () => {
  await cleanup();
  const email = `${testPrefix}_invite@example.com`;
  const auditResource = `${testPrefix}_invite_resource`;
  await prisma.staffAccount.create({
    data: {
      id: `${testPrefix}_master`,
      email: `${testPrefix}_master@example.com`,
      roleName: "Moderator",
      status: "active",
      isMasterAdmin: false,
      firstName: null,
      lastName: null,
      phone: null,
      passwordHash: null,
      invitedAt: null,
      registeredAt: null,
      activatedAt: null,
      blockedAt: null,
      removedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  const invitationResult = await createInvitation({
    repository,
    clientUrl,
    email,
    roleName: "Support Lead",
    invitedById: `${testPrefix}_master`,
    now,
    sendEmail: async () => {},
    audit: async (tx, event) => tx.insertAuditLog({ ...event, actorId: `${testPrefix}_master`, resourceId: auditResource }),
  });

  const storedAccount = await prisma.staffAccount.findUnique({ where: { email } });
  assert.equal(storedAccount.status, "invited");
  assert.equal(storedAccount.roleName, "Support Lead");
  const storedInvitation = await prisma.staffInvitation.findUnique({ where: { tokenHash: invitationResult.invitation.tokenHash } });
  assert.equal(storedInvitation.tokenHash, hashToken(invitationResult.token));
  assert.equal(storedInvitation.email, email);

  const validation = await validateInvitation({ repository, token: invitationResult.token, now });
  assert.equal(validation.valid, true);

  const acceptance = await acceptInvitation({
    repository,
    token: invitationResult.token,
    firstName: "Ada",
    lastName: "Lovelace",
    password: "StrongPass123",
    confirmPassword: "StrongPass123",
    phone: "555-0101",
    now,
    hashPasswordFn: hashPassword,
    audit: async (tx, event) => tx.insertAuditLog({ ...event, actorId: `${testPrefix}_system`, resourceId: `${testPrefix}_registration` }),
  });

  assert.equal(acceptance.staffAccount.status, "active");
  assert.equal(acceptance.staffAccount.firstName, "Ada");
  assert.equal(acceptance.staffAccount.lastName, "Lovelace");
  assert.equal(acceptance.staffAccount.registeredAt.toISOString(), now.toISOString());
  assert.equal(await verifyPassword(acceptance.staffAccount.passwordHash, "StrongPass123"), true);
  assert.equal(await verifyPassword(acceptance.staffAccount.passwordHash, "WrongPass123"), false);
  const acceptedInvitation = await prisma.staffInvitation.findUnique({ where: { id: invitationResult.invitation.id } });
  assert.equal(acceptedInvitation.status, "accepted");
  const auditRows = await prisma.auditLog.findMany({
    where: {
      OR: [
        { resourceId: `${testPrefix}_invite_resource` },
        { resourceId: `${testPrefix}_registration` },
      ],
    },
  });
  assert.ok(auditRows.length >= 2);
  const auditJson = JSON.stringify(auditRows);
  assert.doesNotMatch(auditJson, /StrongPass123|passwordHash|tokenHash|jwt/i);
  assert.equal(await prisma.permission.count(), 33);
  assert.equal(await prisma.staffPermission.count(), 0);
  assert.equal(await prisma.staffRole.count(), 0);
  const masterAdminCount = await prisma.masterAdmin.count();
  const masterAdminRefreshCount = await prisma.masterAdminRefreshToken.count();
  assert.equal(masterAdminCount, 0);
  assert.equal(masterAdminRefreshCount, 0);
});

dbTest("double acceptance fails safely", async () => {
  await cleanup();
  const email = `${testPrefix}_double@example.com`;
  const invitationResult = await createInvitation({ repository, clientUrl, email, now, sendEmail: async () => {} });
  await acceptInvitation({
    repository,
    token: invitationResult.token,
    firstName: "Ada",
    lastName: "Lovelace",
    password: "StrongPass123",
    confirmPassword: "StrongPass123",
    now,
    hashPasswordFn: hashPassword,
  });
  await assert.rejects(() => acceptInvitation({
    repository,
    token: invitationResult.token,
    firstName: "Ada",
    lastName: "Lovelace",
    password: "StrongPass123",
    confirmPassword: "StrongPass123",
    now,
    hashPasswordFn: hashPassword,
  }), /already been used/);
  const activeAccounts = await prisma.staffAccount.findMany({ where: { email } });
  assert.equal(activeAccounts.length, 1);
});

dbTest("resend invalidates old invitation and reuses staff account", async () => {
  await cleanup();
  const email = `${testPrefix}_resend@example.com`;
  const invitationResult = await createInvitation({ repository, clientUrl, email, now, sendEmail: async () => {} });
  const resendResult = await resendInvitation({ repository, clientUrl, staffAccountId: invitationResult.staffAccount.id, now, sendEmail: async () => {} });
  const oldValidation = await validateInvitation({ repository, token: invitationResult.token, now });
  const newValidation = await validateInvitation({ repository, token: resendResult.token, now });
  assert.equal(oldValidation.valid, false);
  assert.equal(newValidation.valid, true);
  assert.equal(resendResult.staffAccount.id, invitationResult.staffAccount.id);
});
