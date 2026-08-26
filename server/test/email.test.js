import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createInvitation, resendInvitation } from "../src/services/staffOnboarding.js";
import { EmailDeliveryError, buildInvitationMessage, buildSmtpTransportOptions, resetSmtpTransportForTests, sendEmail, sendInvitationEmail, verifySmtpTransport } from "../src/lib/email.js";

function createRepository() {
  const state = {
    staffAccounts: [],
    invitations: [],
    audits: [],
    counters: { staff: 0, invitation: 0, audit: 0 },
  };
  const db = {
    state,
    findStaffByEmail: async (email) => db.staffAccount.findUnique({ where: { email } }),
    findStaffById: async (id) => db.staffAccount.findUnique({ where: { id } }),
    findPendingInvitationByStaffAccountId: async (staffAccountId) => db.staffInvitation.findFirst({ where: { staffAccountId, status: "pending" } }),
    findInvitationByTokenHash: async (tokenHash) => db.staffInvitation.findUnique({ where: { tokenHash } }),
    invalidatePendingInvitations: async (staffAccountId, now) => db.staffInvitation.updateMany({ where: { staffAccountId, status: "pending" }, data: { status: "revoked", revokedAt: now, updatedAt: now } }),
    createStaffAccount: async (data) => db.staffAccount.create({ data }),
    updateStaffAccount: async (id, data) => db.staffAccount.update({ where: { id }, data }),
    createInvitation: async (data) => db.staffInvitation.create({ data }),
    updateInvitation: async (id, data) => db.staffInvitation.update({ where: { id }, data }),
    revokeInvitation: async (id, now) => db.staffInvitation.update({ where: { id }, data: { status: "revoked", revokedAt: now, updatedAt: now } }),
    insertAuditLog: async (data) => db.auditLog.create({ data }),
    withTransaction: async (work) => work(db),
    staffAccount: {
      findUnique: async ({ where }) => state.staffAccounts.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
      create: async ({ data }) => {
        const created = { id: `staff-${++state.counters.staff}`, ...data };
        state.staffAccounts.push(created);
        return created;
      },
      update: async ({ where, data }) => {
        const row = state.staffAccounts.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    staffInvitation: {
      findFirst: async ({ where }) => state.invitations.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
      findUnique: async ({ where }) => state.invitations.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of state.invitations) {
          if (Object.entries(where).every(([key, value]) => row[key] === value)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
      create: async ({ data }) => {
        const created = { id: `inv-${++state.counters.invitation}`, ...data };
        state.invitations.push(created);
        return created;
      },
      update: async ({ where, data }) => {
        const row = state.invitations.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }) => {
        const created = { id: `audit-${++state.counters.audit}`, ...data };
        state.audits.push(created);
        return created;
      },
    },
    $transaction: async (work) => work(db),
  };
  return db;
}

test("smtp transport maps settings and invitation email renders expected content", async (t) => {
  const backup = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    SMTP_FROM: process.env.SMTP_FROM,
  };
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_SECURE = "false";
  process.env.SMTP_USER = "mailer@example.test";
  process.env.SMTP_PASSWORD = "super-secret-password";
  process.env.SMTP_FROM = "Admin Staff <no-reply@example.test>";
  t.after(() => {
    for (const [key, value] of Object.entries(backup)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetSmtpTransportForTests();
  });

  const mapped = buildSmtpTransportOptions();
  assert.deepEqual(mapped, {
    host: "smtp.example.test",
    port: 587,
    secure: false,
    auth: {
      user: "mailer@example.test",
      pass: "super-secret-password",
    },
  });

  const sent = [];
  const transport = {
    sendMail: async (payload) => {
      sent.push(payload);
      return { messageId: "msg-123" };
    },
    verify: async () => true,
  };

  const info = await sendInvitationEmail({
    email: "person@example.test",
    url: "https://example.test/admin-staff/staff/register?token=raw-token",
    roleName: "Support Lead",
    expiresInHours: 48,
  }, { transport, logger: { info() {}, warn() {}, error() {} } });

  assert.equal(info.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "person@example.test");
  assert.equal(sent[0].subject, "Invitation to join Admin + Staff Management System");
  assert.match(sent[0].text, /raw-token/);
  assert.match(sent[0].text, /Support Lead/);
  assert.match(sent[0].html, /admin-staff\/staff\/register\?token=raw-token/);
  assert.doesNotMatch(JSON.stringify(sent[0]), /tokenHash|super-secret-password/i);
  assert.equal(sent.some((entry) => JSON.stringify(entry).includes("super-secret-password")), false);
});

test("smtp verification helper accepts injected transport", async () => {
  await assert.doesNotReject(() => verifySmtpTransport({
    transport: {
      verify: async () => true,
      sendMail: async () => ({}),
    },
  }));
});

test("smtp logging stays free of raw credentials", async () => {
  const logs = [];
  await sendEmail(
    { to: "person@example.test", subject: "Subject", text: "Text", html: "<p>Text</p>" },
    {
      transport: {
        sendMail: async () => ({ messageId: "msg-1" }),
      },
      from: "Admin Staff <no-reply@example.test>",
      logger: {
        info: (...args) => logs.push(args),
        warn: (...args) => logs.push(args),
        error: (...args) => logs.push(args),
      },
    },
  );
  assert.equal(JSON.stringify(logs).includes("super-secret-password"), false);
});

test("invitation creation and resend use fresh raw URLs and fail safely when email delivery fails", async () => {
  const repository = createRepository();
  const emails = [];
  const failingEmail = async () => { throw new EmailDeliveryError("Unable to deliver invitation email."); };

  const first = await createInvitation({
    repository,
    clientUrl: "https://example.test/admin-staff",
    email: "invite@example.test",
    roleName: "Support Lead",
    invitedByType: "master_admin",
    invitedById: "master-1",
    sendEmail: async (payload) => { emails.push(payload); },
  });

  const resend = await resendInvitation({
    repository,
    clientUrl: "https://example.test/admin-staff",
    staffAccountId: first.staffAccount.id,
    invitedByType: "master_admin",
    invitedById: "master-1",
    sendEmail: async (payload) => { emails.push(payload); },
  });

  assert.notEqual(first.token, resend.token);
  assert.notEqual(first.invitationUrl, resend.invitationUrl);
  assert.equal(emails.length, 2);
  assert.match(emails[0].url, /\/admin-staff\/staff\/register\?token=/);
  assert.match(emails[1].url, /\/admin-staff\/staff\/register\?token=/);

  const failed = createInvitation({
    repository,
    clientUrl: "https://example.test/admin-staff",
    email: "failed@example.test",
    roleName: "Support Lead",
    invitedByType: "master_admin",
    invitedById: "master-1",
    sendEmail: failingEmail,
  });
  await assert.rejects(failed, /Unable to deliver invitation email/);
  const failedInvitation = repository.state.invitations.find((row) => row.email === "failed@example.test");
  assert.equal(failedInvitation.status, "pending");
});

test("admin invitation route returns a safe 502 when SMTP delivery fails", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = previousDatabaseUrl || "postgresql://placeholder:placeholder@localhost:5433/placeholder";
  const { createAdminInvitationsRouter } = await import("../src/routes/adminInvitations.js");
  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminInvitationsRouter({
    requireAuth: (_req, _res, next) => next(),
    masterAdminFactory: () => ({ invitedByType: "master_admin", invitedById: "master-1", actorType: "master_admin", actorId: "master-1" }),
    createInvitation: async () => { throw new EmailDeliveryError("Unable to deliver invitation email."); },
    resendInvitation: async () => { throw new EmailDeliveryError("Unable to deliver invitation email."); },
    revokeInvitation: async () => ({ staffAccount: { id: "staff-1" }, invitationId: "inv-1" }),
    repository: createRepository(),
    audit: async () => {},
    sendEmail: async () => {},
  }));

  const res = await request(app)
    .post("/api/admin/staff/invitations")
    .send({ email: "invite@example.test", roleName: "Support Lead" })
    .expect(502);

  assert.equal(res.body.message, "Invitation email could not be delivered.");
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
