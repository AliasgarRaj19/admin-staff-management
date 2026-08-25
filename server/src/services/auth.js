import crypto from "node:crypto";
import { AUDIT_ACTOR_TYPES, AUDIT_RESULTS } from "../domain/audit.js";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword, randomToken, hashSecret } from "../lib/crypto.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt.js";
import { sendEmail } from "./email.js";
import { env } from "../config/env.js";

const REFRESH_HANDOFF_WINDOW_MS = 5_000;

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function maskEmail(email) {
  return String(email || "").replace(/(.{2}).+(@.+)/, "$1***$2");
}

function buildPublicUrl(pathname) {
  const basePath = env.APP_BASE_PATH || "";
  const normalizedBasePath = basePath && !basePath.startsWith("/") ? `/${basePath}` : basePath;
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${String(env.APP_URL || "").replace(/\/+$/, "")}${normalizedBasePath}${normalizedPath}`;
}

function normalizeRefreshToken(refreshToken) {
  return typeof refreshToken === "string" && refreshToken.trim() ? refreshToken : null;
}

async function writeAuthAudit(event) {
  await prisma.auditLog.create({
    data: {
      id: crypto.randomUUID(),
      actorType: event.actorType,
      actorId: event.actorId || null,
      actorStaffAccountId: event.actorStaffAccountId || null,
      action: event.action,
      resourceType: event.resourceType || null,
      resourceId: event.resourceId || null,
      result: event.result || AUDIT_RESULTS.SUCCESS,
      metadata: event.metadata || null,
      ipAddress: event.ipAddress || null,
      userAgent: event.userAgent || null,
      createdAt: new Date(),
    },
  });
}

async function storeRefreshToken({ staffAccountId, familyId, refreshToken, tokenId }) {
  await prisma.staffRefreshToken.create({
    data: {
      id: tokenId,
      staffAccountId,
      tokenHash: hashSecret(refreshToken),
      jti: crypto.randomUUID(),
      familyId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
}

async function rotateStaffRefreshToken(stored, staff) {
  const accessToken = await signAccessToken({
    sub: staff.id,
    identityType: "staff",
    tokenType: "access",
    roleName: staff.roleName,
  });
  const newRefreshToken = await signRefreshToken({
    sub: staff.id,
    identityType: "staff",
    tokenType: "refresh",
  });
  const newTokenId = crypto.randomUUID();
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.staffRefreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: now, replacedByTokenId: newTokenId },
    });
    if (!claim.count) {
      const current = await tx.staffRefreshToken.findUnique({ where: { id: stored.id } });
      if (current?.revokedAt && current.replacedByTokenId && now.getTime() - new Date(current.revokedAt).getTime() <= REFRESH_HANDOFF_WINDOW_MS) {
        return { status: "retry" };
      }
      return null;
    }
    await tx.staffRefreshToken.create({
      data: {
        id: newTokenId,
        staffAccountId: staff.id,
        tokenHash: hashSecret(newRefreshToken),
        jti: crypto.randomUUID(),
        familyId: stored.familyId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return { accessToken, refreshToken: newRefreshToken, user: staff };
  });
  return result;
}

export async function loginStaff(email, password) {
  const staff = await prisma.staffAccount.findUnique({ where: { email: normalizeEmail(email) } });
  if (!staff || staff.status !== "active") return { status: "generic" };
  if (!staff.passwordHash || !(await verifyPassword(staff.passwordHash, password))) return { status: "generic" };
  const accessToken = await signAccessToken({
    sub: staff.id,
    identityType: "staff",
    tokenType: "access",
    roleName: staff.roleName,
  });
  const refreshToken = await signRefreshToken({
    sub: staff.id,
    identityType: "staff",
    tokenType: "refresh",
  });
  await prisma.staffRefreshToken.create({
    data: {
      id: crypto.randomUUID(),
      staffAccountId: staff.id,
      tokenHash: hashSecret(refreshToken),
      jti: crypto.randomUUID(),
      familyId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  await writeAuthAudit({
    actorType: AUDIT_ACTOR_TYPES.STAFF,
    actorId: staff.id,
    actorStaffAccountId: staff.id,
    action: "staff.auth.login_succeeded",
    resourceType: "staff_session",
    resourceId: staff.id,
    result: AUDIT_RESULTS.SUCCESS,
  });
  return { staff, accessToken, refreshToken };
}

export async function refreshStaffSession(refreshToken) {
  const rawToken = normalizeRefreshToken(refreshToken);
  if (!rawToken) return null;
  const tokenHash = hashSecret(rawToken);
  const { payload } = await verifyRefreshToken(rawToken).catch(() => ({ payload: null }));
  if (!payload || payload.identityType !== "staff") return null;
  const stored = await prisma.staffRefreshToken.findUnique({ where: { tokenHash } });
  const now = new Date();
  if (!stored) return null;
  if (stored.revokedAt) {
    if (stored.replacedByTokenId && now.getTime() - new Date(stored.revokedAt).getTime() <= REFRESH_HANDOFF_WINDOW_MS) {
      return { status: "retry" };
    }
    return null;
  }
  if (stored.expiresAt < now) return null;
  const staff = await prisma.staffAccount.findUnique({ where: { id: payload.sub } });
  if (!staff || staff.status !== "active") return null;
  const rotated = await rotateStaffRefreshToken(stored, staff);
  await writeAuthAudit({
    actorType: AUDIT_ACTOR_TYPES.STAFF,
    actorId: staff.id,
    actorStaffAccountId: staff.id,
    action: "staff.auth.refresh_succeeded",
    resourceType: "staff_session",
    resourceId: staff.id,
    result: AUDIT_RESULTS.SUCCESS,
  });
  return rotated;
}

export async function logoutStaff(refreshToken) {
  const rawToken = normalizeRefreshToken(refreshToken);
  if (!rawToken) return;
  const tokenHash = hashSecret(rawToken);
  const result = await prisma.staffRefreshToken.findUnique({ where: { tokenHash } });
  await prisma.staffRefreshToken.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } });
  if (result) {
    await writeAuthAudit({
      actorType: AUDIT_ACTOR_TYPES.STAFF,
      actorId: result.staffAccountId,
      actorStaffAccountId: result.staffAccountId,
      action: "staff.auth.logout",
      resourceType: "staff_session",
      resourceId: result.staffAccountId,
      result: AUDIT_RESULTS.SUCCESS,
    });
  }
}

export async function getCurrentStaff(staffId) {
  const staff = await prisma.staffAccount.findUnique({ where: { id: staffId } });
  if (!staff || staff.status !== "active") return null;
  return {
    id: staff.id,
    email: staff.email,
    firstName: staff.firstName,
    lastName: staff.lastName,
    phone: staff.phone,
    roleName: staff.roleName,
    status: staff.status,
    registeredAt: staff.registeredAt,
  };
}
