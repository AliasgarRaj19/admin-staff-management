import test from "node:test";
import assert from "node:assert/strict";
import { createInvitation, acceptInvitation, resendInvitation, revokeInvitation, validateInvitation } from "../src/services/staffOnboarding.js";
import { createStaffRepository } from "../src/repositories/staffRepository.js";
import { hashToken } from "../src/lib/token.js";

function createMemoryDb() {
  const state = {
    staffAccounts: [],
    invitations: [],
    auditLogs: [],
    counters: { staff: 0, invitation: 0, audit: 0 },
  };

  const db = {
    state,
    staffAccount: {
      findUnique: async ({ where }) => state.staffAccounts.find((item) => Object.entries(where).every(([key, value]) => item[key] === value)) ?? null,
      create: async ({ data }) => {
        const created = { id: `staff-${++state.counters.staff}`, ...data };
        state.staffAccounts.push(created);
        return created;
      },
      update: async ({ where, data }) => {
        const account = state.staffAccounts.find((item) => item.id === where.id);
        Object.assign(account, data);
        return account;
      },
    },
    staffInvitation: {
      findFirst: async ({ where }) => state.invitations.find((item) => Object.entries(where).every(([key, value]) => item[key] === value)) ?? null,
      findUnique: async ({ where }) => state.invitations.find((item) => Object.entries(where).every(([key, value]) => item[key] === value)) ?? null,
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const invitation of state.invitations) {
          if (Object.entries(where).every(([key, value]) => invitation[key] === value)) {
            Object.assign(invitation, data);
            count += 1;
          }
        }
        return { count };
      },
      create: async ({ data }) => {
        const created = { id: `invitation-${++state.counters.invitation}`, ...data };
        state.invitations.push(created);
        return created;
      },
      update: async ({ where, data }) => {
        const invitation = state.invitations.find((item) => item.id === where.id);
        Object.assign(invitation, data);
        return invitation;
      },
    },
    auditLog: {
      create: async ({ data }) => {
        const created = { id: `audit-${++state.counters.audit}`, ...data };
        state.auditLogs.push(created);
        return created;
      },
    },
    $transaction: async (work) => work(createStaffRepository(db)),
  };

  return Object.assign(db, createStaffRepository(db));
}

test("blank role name becomes Moderator and custom role name is preserved", async () => {
  const repository = createMemoryDb();
  const sends = [];
  const result = await createInvitation({
    repository,
    clientUrl: "https://example.test",
    email: "  Sales@Example.com ",
    roleName: "  Sales Manager  ",
    invitedById: "master-1",
    now: new Date("2026-08-25T00:00:00Z"),
    sendEmail: async (payload) => { sends.push(payload); },
  });

  assert.equal(result.staffAccount.email, "sales@example.com");
  assert.equal(result.staffAccount.roleName, "Sales Manager");
  assert.equal(result.invitation.roleName, "Sales Manager");
  assert.match(result.invitationUrl, /\/staff\/register\?token=/);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].roleName, "Sales Manager");
});

test("blank role name defaults to Moderator", async () => {
  const repository = createMemoryDb();
  const result = await createInvitation({
    repository,
    clientUrl: "https://example.test",
    email: "staff@example.com",
    roleName: "   ",
    now: new Date("2026-08-25T00:00:00Z"),
    sendEmail: async () => {},
  });

  assert.equal(result.staffAccount.roleName, "Moderator");
  assert.equal(result.invitation.roleName, "Moderator");
});

test("multiple staff accounts may share the same roleName designation", async () => {
  const repository = createMemoryDb();
  const first = await createInvitation({
    repository,
    clientUrl: "https://example.test",
    email: "first@example.com",
    roleName: "Support Lead",
    sendEmail: async () => {},
  });
  const second = await createInvitation({
    repository,
    clientUrl: "https://example.test",
    email: "second@example.com",
    roleName: "Support Lead",
    sendEmail: async () => {},
  });

  assert.equal(first.staffAccount.roleName, "Support Lead");
  assert.equal(second.staffAccount.roleName, "Support Lead");
  assert.notEqual(first.staffAccount.id, second.staffAccount.id);
});

test("active, blocked, and removed duplicate emails are rejected", async () => {
  const repository = createMemoryDb();
  await repository.createStaffAccount({ email: "active@example.com", roleName: "Moderator", status: "active" });
  await repository.createStaffAccount({ email: "blocked@example.com", roleName: "Moderator", status: "blocked" });
  await repository.createStaffAccount({ email: "removed@example.com", roleName: "Moderator", status: "removed" });

  await assert.rejects(() => createInvitation({ repository, clientUrl: "https://example.test", email: "active@example.com", sendEmail: async () => {} }), /already registered/);
  await assert.rejects(() => createInvitation({ repository, clientUrl: "https://example.test", email: "blocked@example.com", sendEmail: async () => {} }), /blocked/);
  await assert.rejects(() => createInvitation({ repository, clientUrl: "https://example.test", email: "removed@example.com", sendEmail: async () => {} }), /removed/);
});

test("invited duplicate reissues a new invitation for the same staff account", async () => {
  const repository = createMemoryDb();
  const staffAccount = await repository.createStaffAccount({ email: "invite@example.com", roleName: "Support Lead", status: "invited" });
  const oldInvitation = await repository.createInvitation({
    staffAccountId: staffAccount.id,
    email: staffAccount.email,
    tokenHash: hashToken("old-token"),
    roleName: staffAccount.roleName,
    invitedById: "master-1",
    status: "pending",
    expiresAt: new Date("2026-08-26T00:00:00Z"),
    acceptedAt: null,
    revokedAt: null,
  });

  const result = await createInvitation({
    repository,
    clientUrl: "https://example.test",
    email: staffAccount.email,
    roleName: staffAccount.roleName,
    invitedById: "master-1",
    now: new Date("2026-08-25T00:00:00Z"),
    sendEmail: async () => {},
  });

  assert.equal(result.staffAccount.id, staffAccount.id);
  assert.equal(result.invitation.staffAccountId, staffAccount.id);
  assert.notEqual(result.invitation.tokenHash, oldInvitation.tokenHash);
  assert.equal(oldInvitation.status, "revoked");
});

test("raw token is not stored and hash is stored", async () => {
  const repository = createMemoryDb();
  const result = await createInvitation({
    repository,
    clientUrl: "https://example.test",
    email: "token@example.com",
    now: new Date("2026-08-25T00:00:00Z"),
    sendEmail: async () => {},
  });

  assert.notEqual(result.token, result.invitation.tokenHash);
  assert.equal(result.invitation.tokenHash, hashToken(result.token));
  assert.equal(result.invitation.expiresAt.toISOString(), "2026-08-27T00:00:00.000Z");
  assert.equal(typeof result.token, "string");
  assert.equal(result.token.length > 20, true);
});

test("validate invitation rejects malformed, expired, revoked, used, and unknown tokens", async () => {
  const repository = createMemoryDb();
  const issued = await createInvitation({
    repository,
    clientUrl: "https://example.test",
    email: "validate@example.com",
    now: new Date("2026-08-25T00:00:00Z"),
    sendEmail: async () => {},
  });

  const invalid = await validateInvitation({ repository, token: "not-a-token", now: new Date("2026-08-25T00:00:00Z") });
  assert.equal(invalid.valid, false);

  const valid = await validateInvitation({ repository, token: issued.token, now: new Date("2026-08-25T00:00:00Z") });
  assert.equal(valid.valid, true);

  const invitation = repository.state.invitations[0];
  invitation.expiresAt = new Date("2026-08-24T23:59:59Z");
  const expired = await validateInvitation({ repository, token: issued.token, now: new Date("2026-08-25T00:00:00Z") });
  assert.equal(expired.reason, "expired");

  invitation.expiresAt = new Date("2026-08-27T00:00:00Z");
  invitation.revokedAt = new Date("2026-08-25T01:00:00Z");
  const revoked = await validateInvitation({ repository, token: issued.token, now: new Date("2026-08-25T00:00:00Z") });
  assert.equal(revoked.reason, "revoked");

  invitation.revokedAt = null;
  invitation.status = "accepted";
  const accepted = await validateInvitation({ repository, token: issued.token, now: new Date("2026-08-25T00:00:00Z") });
  assert.equal(accepted.reason, "accepted");

  invitation.status = "pending";
  invitation.acceptedAt = new Date("2026-08-25T01:00:00Z");
  const used = await validateInvitation({ repository, token: issued.token, now: new Date("2026-08-25T00:00:00Z") });
  assert.equal(used.reason, "used");
});

test("resend invalidates the old invitation and reuses the same staff account", async () => {
  const repository = createMemoryDb();
  const staffAccount = await repository.createStaffAccount({ email: "resend@example.com", roleName: "Moderator", status: "invited" });
  const oldInvitation = await repository.createInvitation({
    staffAccountId: staffAccount.id,
    email: staffAccount.email,
    tokenHash: hashToken("old-token"),
    roleName: staffAccount.roleName,
    invitedById: "master-1",
    status: "pending",
    expiresAt: new Date("2026-08-26T00:00:00Z"),
    acceptedAt: null,
    revokedAt: null,
  });

  const result = await resendInvitation({
    repository,
    clientUrl: "https://example.test",
    staffAccountId: staffAccount.id,
    invitedById: "master-1",
    now: new Date("2026-08-25T00:00:00Z"),
    sendEmail: async () => {},
  });

  assert.equal(result.staffAccount.id, staffAccount.id);
  assert.equal(oldInvitation.status, "revoked");
  assert.equal(repository.state.invitations.length, 2);
  assert.equal(repository.state.invitations[1].staffAccountId, staffAccount.id);
  assert.notEqual(repository.state.invitations[0].tokenHash, repository.state.invitations[1].tokenHash);
});

test("revoke keeps staff account invited", async () => {
  const repository = createMemoryDb();
  const staffAccount = await repository.createStaffAccount({ email: "revoke@example.com", roleName: "Moderator", status: "invited" });
  const invitation = await repository.createInvitation({
    staffAccountId: staffAccount.id,
    email: staffAccount.email,
    tokenHash: hashToken("revoke-token"),
    roleName: staffAccount.roleName,
    invitedById: "master-1",
    status: "pending",
    expiresAt: new Date("2026-08-26T00:00:00Z"),
    acceptedAt: null,
    revokedAt: null,
  });

  const result = await revokeInvitation({
    repository,
    staffAccountId: staffAccount.id,
    now: new Date("2026-08-25T00:00:00Z"),
  });

  assert.equal(result.invitationId, invitation.id);
  assert.equal(repository.state.invitations[0].status, "revoked");
  assert.equal(repository.state.staffAccounts[0].status, "invited");
});

test("acceptance hashes password, activates account, and consumes invitation", async () => {
  const repository = createMemoryDb();
  const staffAccount = await repository.createStaffAccount({ email: "accept@example.com", roleName: "Support Lead", status: "invited" });
  const invitation = await repository.createInvitation({
    staffAccountId: staffAccount.id,
    email: staffAccount.email,
    tokenHash: hashToken("accept-token"),
    roleName: staffAccount.roleName,
    invitedById: "master-1",
    status: "pending",
    expiresAt: new Date("2026-08-26T00:00:00Z"),
    acceptedAt: null,
    revokedAt: null,
  });

  const auditEvents = [];
  const result = await acceptInvitation({
    repository,
    token: "accept-token",
    firstName: "  Ada  ",
    lastName: "  Lovelace  ",
    password: "StrongPass123",
    confirmPassword: "StrongPass123",
    phone: " 555-0101 ",
    now: new Date("2026-08-25T00:00:00Z"),
    hashPasswordFn: async (password) => `argon2id:${password}`,
    audit: async (tx, event) => { auditEvents.push(event); return tx.insertAuditLog(event); },
  });

  assert.equal(result.staffAccount.status, "active");
  assert.equal(result.staffAccount.firstName, "Ada");
  assert.equal(result.staffAccount.lastName, "Lovelace");
  assert.equal(result.staffAccount.phone, "555-0101");
  assert.equal(result.staffAccount.passwordHash, "argon2id:StrongPass123");
  assert.equal(result.staffAccount.registeredAt.toISOString(), "2026-08-25T00:00:00.000Z");
  assert.equal(repository.state.invitations[0].status, "accepted");
  assert.equal(repository.state.invitations[0].acceptedAt.toISOString(), "2026-08-25T00:00:00.000Z");
  assert.equal(repository.state.staffAccounts[0].status, "active");
  assert.equal(auditEvents.some((event) => event.action === "staff.registration.completed"), true);
  assert.equal(auditEvents.some((event) => event.action === "staff.invitation.accepted"), true);
  await assert.rejects(() => acceptInvitation({
    repository,
    token: "accept-token",
    firstName: "Ada",
    lastName: "Lovelace",
    password: "StrongPass123",
    confirmPassword: "StrongPass123",
    now: new Date("2026-08-25T00:00:00Z"),
    hashPasswordFn: async (password) => `argon2id:${password}`,
  }), /already been used/);
});
