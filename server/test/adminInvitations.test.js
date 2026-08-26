import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

test("admin invitations list returns only safe fields for pending invitations", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = previousDatabaseUrl || "postgresql://placeholder:placeholder@localhost:5433/placeholder";
  const { createAdminInvitationsRouter } = await import("../src/routes/adminInvitations.js");
  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminInvitationsRouter({
    requireAuth: (_req, _res, next) => next(),
    repository: {
      listInvitations: async ({ status }) => {
        assert.equal(status, "pending");
        return [{
          id: "inv-1",
          staffAccountId: "staff-1",
          email: "invite@example.com",
          roleName: "Support Lead",
          status: "pending",
          createdAt: "2026-08-26T00:00:00.000Z",
          expiresAt: "2026-08-28T00:00:00.000Z",
          invitedByType: "master_admin",
          tokenHash: "secret-hash",
          rawToken: "secret-token",
          passwordHash: "secret-password",
        }];
      },
      withTransaction: async (work) => work({}),
      findStaffById: async () => null,
      findPendingInvitationByStaffAccountId: async () => null,
    },
    masterAdminFactory: () => ({ invitedByType: "master_admin", invitedById: "admin-1", actorType: "master_admin", actorId: "admin-1" }),
    createInvitation: async () => { throw new Error("unused"); },
    resendInvitation: async () => { throw new Error("unused"); },
    revokeInvitation: async () => { throw new Error("unused"); },
  }));

  const res = await request(app).get("/api/admin/staff/invitations").expect(200);
  assert.deepEqual(res.body.invitations, [{
    id: "inv-1",
    staffAccountId: "staff-1",
    email: "invite@example.com",
    roleName: "Support Lead",
    status: "pending",
    createdAt: "2026-08-26T00:00:00.000Z",
    expiresAt: "2026-08-28T00:00:00.000Z",
    invitedByType: "master_admin",
  }]);

  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
