import { Router } from "express";
import { requireMasterAdminAuth } from "../middleware/masterAdminAuth.js";
import { prisma } from "../lib/prisma.js";
import { createStaffRepository } from "../repositories/staffRepository.js";
import { createInvitation, resendInvitation, revokeInvitation } from "../services/staffOnboarding.js";
import { sendInvitationEmail } from "../lib/email.js";
import { recordAuditEvent } from "../lib/audit.js";

const router = Router();
const repository = createStaffRepository(prisma);

router.use(requireMasterAdminAuth);

router.get("/staff/invitations", async (_req, res) => {
  const invitations = await prisma.staffInvitation.findMany();
  res.json({
    invitations: invitations.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)),
  });
});

router.post("/staff/invitations", async (req, res) => {
  try {
    const result = await createInvitation({
      repository,
      clientUrl: String(process.env.CLIENT_URL || "").trim() || "http://localhost:5501",
      email: req.body?.email,
      roleName: req.body?.roleName,
      invitedById: req.masterAdmin.id,
      sendEmail: sendInvitationEmail,
      audit: recordAuditEvent,
      actorType: "master_admin",
      actorId: req.masterAdmin.id,
    });
    res.status(201).json({
      staffAccount: result.staffAccount,
      invitation: result.invitation,
      invitationUrl: result.invitationUrl,
      token: result.token,
    });
  } catch (error) {
    res.status(400).json({ message: String(error?.message || "Failed to create invitation") });
  }
});

router.post("/staff/invitations/:staffAccountId/resend", async (req, res) => {
  try {
    const result = await resendInvitation({
      repository,
      clientUrl: String(process.env.CLIENT_URL || "").trim() || "http://localhost:5501",
      staffAccountId: req.params.staffAccountId,
      invitedById: req.masterAdmin.id,
      sendEmail: sendInvitationEmail,
      audit: recordAuditEvent,
      actorType: "master_admin",
      actorId: req.masterAdmin.id,
    });
    res.json({
      staffAccount: result.staffAccount,
      invitation: result.invitation,
      invitationUrl: result.invitationUrl,
      token: result.token,
    });
  } catch (error) {
    res.status(400).json({ message: String(error?.message || "Failed to resend invitation") });
  }
});

router.post("/staff/invitations/:staffAccountId/revoke", async (req, res) => {
  try {
    const result = await revokeInvitation({
      repository,
      staffAccountId: req.params.staffAccountId,
      audit: recordAuditEvent,
      actorType: "master_admin",
      actorId: req.masterAdmin.id,
    });
    res.json({ staffAccount: result.staffAccount, invitationId: result.invitationId });
  } catch (error) {
    res.status(400).json({ message: String(error?.message || "Failed to revoke invitation") });
  }
});

export { router as adminInvitationsRouter };
