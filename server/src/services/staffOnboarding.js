import { AUDIT_ACTOR_TYPES, AUDIT_RESULTS } from "../domain/audit.js";
import { env } from "../config/env.js";
import { buildAuditEvent, recordAuditEvent } from "../lib/audit.js";
import { sendInvitationEmail } from "../lib/email.js";
import { hashPassword } from "../lib/password.js";
import { buildClientUrlPath } from "../lib/urls.js";
import { generateOpaqueToken, hashToken, hoursFromNow } from "../lib/token.js";
import { normalizeEmail, normalizeName, normalizeOptionalPhone, normalizeRoleName, validatePassword, validatePasswordConfirmation } from "../lib/validation.js";

function safeInvitationUrl(clientUrl, rawToken) {
  return buildClientUrlPath(clientUrl, env.APP_BASE_PATH || "", `/staff/register?token=${encodeURIComponent(rawToken)}`);
}

async function ensureStaffState(repository, email) {
  const account = await repository.findStaffByEmail(email);
  if (!account) return null;
  if (account.status === "invited") return account;
  if (account.status === "active") throw new Error("This email is already registered.");
  if (account.status === "blocked") throw new Error("This staff account is blocked.");
  if (account.status === "removed") throw new Error("This staff account has been removed.");
  throw new Error("This email cannot be used.");
}

export async function createInvitation({
  repository,
  clientUrl,
  email,
  roleName,
  invitedByType = "master_admin",
  invitedById = null,
  now = new Date(),
  sendEmail = sendInvitationEmail,
  audit = recordAuditEvent,
  actorType = AUDIT_ACTOR_TYPES.MASTER_ADMIN,
  actorId = null,
}) {
  const normalizedEmail = normalizeEmail(email);
  const displayRoleName = normalizeRoleName(roleName);
  const rawToken = generateOpaqueToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = hoursFromNow(48, now);

  const existing = await ensureStaffState(repository, normalizedEmail);
  if (existing && existing.status === "invited") {
    return resendInvitation({
      repository,
      clientUrl,
      staffAccountId: existing.id,
      invitedByType,
      invitedById,
      now,
      sendEmail,
      audit,
      actorType,
      actorId,
      existingStaffAccount: existing,
    });
  }

  const result = await repository.withTransaction(async (tx) => {
    const staffAccount = await tx.createStaffAccount({
      email: normalizedEmail,
      firstName: null,
      lastName: null,
      phone: null,
      passwordHash: null,
      roleName: displayRoleName,
      status: "invited",
      invitedAt: now,
      registeredAt: null,
      activatedAt: null,
      blockedAt: null,
      removedAt: null,
    });

    const invitation = await tx.createInvitation({
      staffAccountId: staffAccount.id,
      email: normalizedEmail,
      tokenHash,
      roleName: displayRoleName,
      invitedByType,
      invitedById,
      status: "pending",
      expiresAt,
      acceptedAt: null,
      revokedAt: null,
    });

    await audit(tx, buildAuditEvent({
      actorType,
      actorId,
      action: "staff.invitation.created",
      resourceType: "staff_invitation",
      resourceId: invitation.id,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { staffAccountId: staffAccount.id, email: normalizedEmail, roleName: displayRoleName },
    }));

    return { staffAccount, invitation };
  });

  const url = safeInvitationUrl(clientUrl, rawToken);
  await sendEmail({ email: normalizedEmail, url, roleName: displayRoleName, expiresInHours: 48 });
  return { ...result, token: rawToken, invitationUrl: url };
}

export async function resendInvitation({
  repository,
  clientUrl,
  staffAccountId,
  invitedByType = "master_admin",
  invitedById = null,
  now = new Date(),
  sendEmail = sendInvitationEmail,
  audit = recordAuditEvent,
  actorType = AUDIT_ACTOR_TYPES.MASTER_ADMIN,
  actorId = null,
  existingStaffAccount = null,
}) {
  const staffAccount = existingStaffAccount ?? await repository.findStaffById(staffAccountId);
  if (!staffAccount) throw new Error("Staff account not found.");
  if (staffAccount.status !== "invited") throw new Error("Only invited staff can receive an invitation.");
  const rawToken = generateOpaqueToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = hoursFromNow(48, now);

  const result = await repository.withTransaction(async (tx) => {
    await tx.invalidatePendingInvitations(staffAccount.id, now);
    const invitation = await tx.createInvitation({
      staffAccountId: staffAccount.id,
      email: staffAccount.email,
      tokenHash,
      roleName: normalizeRoleName(staffAccount.roleName),
      invitedByType,
      invitedById,
      status: "pending",
      expiresAt,
      acceptedAt: null,
      revokedAt: null,
    });

    await audit(tx, buildAuditEvent({
      actorType,
      actorId,
      action: "staff.invitation.resent",
      resourceType: "staff_invitation",
      resourceId: invitation.id,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { staffAccountId: staffAccount.id, email: staffAccount.email },
    }));

    return { staffAccount, invitation };
  });

  const url = safeInvitationUrl(clientUrl, rawToken);
  await sendEmail({ email: staffAccount.email, url, roleName: normalizeRoleName(staffAccount.roleName), expiresInHours: 48 });
  return { ...result, token: rawToken, invitationUrl: url };
}

export async function revokeInvitation({
  repository,
  staffAccountId,
  now = new Date(),
  audit = recordAuditEvent,
  actorType = AUDIT_ACTOR_TYPES.MASTER_ADMIN,
  actorId = null,
}) {
  const staffAccount = await repository.findStaffById(staffAccountId);
  if (!staffAccount) throw new Error("Staff account not found.");
  const invitation = await repository.findPendingInvitationByStaffAccountId(staffAccountId);
  if (!invitation) throw new Error("Only pending invitations can be revoked.");

  await repository.withTransaction(async (tx) => {
    await tx.revokeInvitation(invitation.id, now);
    await audit(tx, buildAuditEvent({
      actorType,
      actorId,
      action: "staff.invitation.revoked",
      resourceType: "staff_invitation",
      resourceId: invitation.id,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { staffAccountId, email: staffAccount.email },
    }));
  });

  return { staffAccount, invitationId: invitation.id };
}

export async function validateInvitation({ repository, token, now = new Date() }) {
  const rawToken = String(token ?? "").trim();
  if (!rawToken) return { valid: false, reason: "invalid" };
  const invitation = await repository.findInvitationByTokenHash(hashToken(rawToken));
  if (!invitation) return { valid: false, reason: "invalid" };
  if (!invitation.staffAccountId) return { valid: false, reason: "invalid" };
  const staffAccount = await repository.findStaffById(invitation.staffAccountId);
  if (!staffAccount || staffAccount.status !== "invited") return { valid: false, reason: "invalid" };
  if (invitation.status !== "pending") return { valid: false, reason: invitation.status };
  if (invitation.revokedAt) return { valid: false, reason: "revoked" };
  if (invitation.acceptedAt) return { valid: false, reason: "used" };
  if (invitation.expiresAt <= now) return { valid: false, reason: "expired" };
  return { valid: true, invitation, staffAccount };
}

export async function acceptInvitation({
  repository,
  token,
  firstName,
  lastName,
  password,
  confirmPassword,
  phone = null,
  now = new Date(),
  hashPasswordFn = hashPassword,
  audit = recordAuditEvent,
  actorType = AUDIT_ACTOR_TYPES.SYSTEM,
  actorId = null,
}) {
  validatePassword(password);
  validatePasswordConfirmation(password, confirmPassword);
  const normalizedPhone = normalizeOptionalPhone(phone);
  const validation = await validateInvitation({ repository, token, now });
  if (!validation.valid) throw new Error("This invitation link is invalid, expired, or has already been used.");

  const { invitation, staffAccount } = validation;
  const normalizedFirstName = normalizeName(firstName, "First name");
  const normalizedLastName = normalizeName(lastName, "Last name");
  const passwordHash = await hashPasswordFn(password);

  const result = await repository.withTransaction(async (tx) => {
    const latestValidation = await validateInvitation({ repository: tx, token, now });
    if (!latestValidation.valid) throw new Error("This invitation link is invalid, expired, or has already been used.");

    const updatedAccount = await tx.updateStaffAccount(staffAccount.id, {
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      phone: normalizedPhone,
      passwordHash,
      status: "active",
      registeredAt: now,
      activatedAt: now,
      updatedAt: now,
    });

    await tx.invalidatePendingInvitations(staffAccount.id, now);
    await tx.updateInvitation(invitation.id, {
      status: "accepted",
      acceptedAt: now,
      revokedAt: null,
      updatedAt: now,
    });

    await audit(tx, buildAuditEvent({
      actorType,
      actorId,
      action: "staff.invitation.accepted",
      resourceType: "staff_invitation",
      resourceId: invitation.id,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { staffAccountId: staffAccount.id, email: staffAccount.email },
    }));

    await audit(tx, buildAuditEvent({
      actorType,
      actorId,
      action: "staff.registration.completed",
      resourceType: "staff_account",
      resourceId: staffAccount.id,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: { staffAccountId: staffAccount.id, email: staffAccount.email, roleName: normalizeRoleName(staffAccount.roleName) },
    }));

    return { staffAccount: updatedAccount, invitationId: invitation.id };
  });

  return { ...result, passwordHash };
}
