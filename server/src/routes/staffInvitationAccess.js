import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { createStaffRepository } from "../repositories/staffRepository.js";
import { acceptInvitation, validateInvitation } from "../services/staffOnboarding.js";
import { hashPassword } from "../lib/password.js";
import { recordAuditEvent } from "../lib/audit.js";

const router = Router();
const repository = createStaffRepository(prisma);

router.post("/validate", async (req, res) => {
  const result = await validateInvitation({ repository, token: req.body?.token, now: new Date() });
  if (!result.valid) {
    return res.status(400).json({ status: result.reason || "invalid" });
  }
  return res.json({
    status: "valid",
    invitation: {
      id: result.invitation.id,
      email: result.invitation.email,
      roleName: result.invitation.roleName,
      expiresAt: result.invitation.expiresAt,
    },
    staffAccount: {
      id: result.staffAccount.id,
      email: result.staffAccount.email,
      roleName: result.staffAccount.roleName,
    },
  });
});

router.post("/accept", async (req, res) => {
  try {
    const result = await acceptInvitation({
      repository,
      token: req.body?.token,
      firstName: req.body?.firstName,
      lastName: req.body?.lastName,
      password: req.body?.password,
      confirmPassword: req.body?.confirmPassword,
      phone: req.body?.phone,
      now: new Date(),
      hashPasswordFn: hashPassword,
      audit: recordAuditEvent,
      actorType: "system",
      actorId: null,
    });
    res.status(201).json({
      staffAccount: result.staffAccount,
      invitationId: result.invitationId,
    });
  } catch (error) {
    res.status(400).json({ message: String(error?.message || "Failed to accept invitation") });
  }
});

export { router as staffInvitationAccessRouter };
