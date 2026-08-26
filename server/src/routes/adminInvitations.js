import { Router } from "express";
import { requireMasterAdminAuth } from "../middleware/masterAdminAuth.js";
import { prisma } from "../lib/prisma.js";
import { createStaffRepository } from "../repositories/staffRepository.js";
import { createInvitation as defaultCreateInvitation, resendInvitation as defaultResendInvitation, revokeInvitation as defaultRevokeInvitation } from "../services/staffOnboarding.js";
import { EmailDeliveryError, sendInvitationEmail } from "../lib/email.js";
import { recordAuditEvent } from "../lib/audit.js";

export function createAdminInvitationsRouter({
  repository = createStaffRepository(prisma),
  createInvitation = defaultCreateInvitation,
  resendInvitation = defaultResendInvitation,
  revokeInvitation = defaultRevokeInvitation,
  sendEmail = sendInvitationEmail,
  audit = recordAuditEvent,
  clientUrl = String(process.env.CLIENT_URL || "").trim() || "http://localhost:5501",
  requireAuth = requireMasterAdminAuth,
  masterAdminFactory = (req) => ({ invitedByType: "master_admin", invitedById: req.masterAdmin.id, actorType: "master_admin", actorId: req.masterAdmin.id }),
} = {}) {
  const router = Router();
  router.use(requireAuth);

  router.get("/staff/invitations", async (_req, res) => {
    const invitations = await prisma.staffInvitation.findMany();
    res.json({
      invitations: invitations.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)),
    });
  });

  router.post("/staff/invitations", async (req, res) => {
    try {
      const actor = masterAdminFactory(req);
      const result = await createInvitation({
        repository,
        clientUrl,
        email: req.body?.email,
        roleName: req.body?.roleName,
        invitedByType: actor.invitedByType,
        invitedById: actor.invitedById,
        sendEmail,
        audit,
        actorType: actor.actorType,
        actorId: actor.actorId,
      });
      res.status(201).json({
        staffAccount: result.staffAccount,
        invitation: result.invitation,
        invitationUrl: result.invitationUrl,
        token: result.token,
      });
    } catch (error) {
      if (error instanceof EmailDeliveryError || error?.code === "EMAIL_DELIVERY_FAILED") {
        return res.status(502).json({ message: "Invitation email could not be delivered." });
      }
      res.status(400).json({ message: String(error?.message || "Failed to create invitation") });
    }
  });

  router.post("/staff/invitations/:staffAccountId/resend", async (req, res) => {
    try {
      const actor = masterAdminFactory(req);
      const result = await resendInvitation({
        repository,
        clientUrl,
        staffAccountId: req.params.staffAccountId,
        invitedByType: actor.invitedByType,
        invitedById: actor.invitedById,
        sendEmail,
        audit,
        actorType: actor.actorType,
        actorId: actor.actorId,
      });
      res.json({
        staffAccount: result.staffAccount,
        invitation: result.invitation,
        invitationUrl: result.invitationUrl,
        token: result.token,
      });
    } catch (error) {
      if (error instanceof EmailDeliveryError || error?.code === "EMAIL_DELIVERY_FAILED") {
        return res.status(502).json({ message: "Invitation email could not be delivered." });
      }
      res.status(400).json({ message: String(error?.message || "Failed to resend invitation") });
    }
  });

  router.post("/staff/invitations/:staffAccountId/revoke", async (req, res) => {
    try {
      const actor = masterAdminFactory(req);
      const result = await revokeInvitation({
        repository,
        staffAccountId: req.params.staffAccountId,
        audit,
        actorType: actor.actorType,
        actorId: actor.actorId,
      });
      res.json({ staffAccount: result.staffAccount, invitationId: result.invitationId });
    } catch (error) {
      res.status(400).json({ message: String(error?.message || "Failed to revoke invitation") });
    }
  });

  return router;
}

export const adminInvitationsRouter = createAdminInvitationsRouter();
