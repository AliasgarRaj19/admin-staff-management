import crypto from "node:crypto";
import { AUDIT_ACTOR_TYPES, AUDIT_RESULTS } from "../domain/audit.js";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword, hashSecret } from "../lib/crypto.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt.js";
import { env } from "../config/env.js";

const REFRESH_HANDOFF_WINDOW_MS = 5_000;
const REFRESH_COOKIE_NAME = "masterAdminRefreshToken";
const CSRF_COOKIE_NAME = "masterAdminCsrfToken";

function normalizeUsername(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeRefreshToken(refreshToken) {
  return typeof refreshToken === "string" && refreshToken.trim() ? refreshToken : null;
}

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.NODE_ENV === "production" ? "strict" : "lax",
    path: "/",
    maxAge: maxAgeMs,
  };
}

async function writeAuthAudit(event) {
  await prisma.auditLog.create({
    data: {
      id: crypto.randomUUID(),
      actorType: event.actorType,
      actorId: event.actorId || null,
      actorStaffAccountId: null,
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

async function storeRefreshToken({ masterAdminId, familyId, refreshToken, tokenId }) {
  await prisma.masterAdminRefreshToken.create({
    data: {
      id: tokenId,
      masterAdminId,
      tokenHash: hashSecret(refreshToken),
      jti: crypto.randomUUID(),
      familyId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
}

async function rotateMasterAdminRefreshToken(stored, masterAdmin) {
  const accessToken = await signAccessToken({
    sub: masterAdmin.id,
    identityType: "master_admin",
    tokenType: "access",
    username: masterAdmin.username,
  });
  const newRefreshToken = await signRefreshToken({
    sub: masterAdmin.id,
    identityType: "master_admin",
    tokenType: "refresh",
  });
  const newTokenId = crypto.randomUUID();
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.masterAdminRefreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: now, replacedByTokenId: newTokenId },
    });
    if (!claim.count) {
      const current = await tx.masterAdminRefreshToken.findUnique({ where: { id: stored.id } });
      if (current?.revokedAt && current.replacedByTokenId && now.getTime() - new Date(current.revokedAt).getTime() <= REFRESH_HANDOFF_WINDOW_MS) {
        return { status: "retry" };
      }
      return null;
    }
    await tx.masterAdminRefreshToken.create({
      data: {
        id: newTokenId,
        masterAdminId: masterAdmin.id,
        tokenHash: hashSecret(newRefreshToken),
        jti: crypto.randomUUID(),
        familyId: stored.familyId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return { accessToken, refreshToken: newRefreshToken, user: masterAdmin };
  });
  return result;
}

export async function loginMasterAdmin(username, password) {
  const masterAdmin = await prisma.masterAdmin.findUnique({ where: { username: normalizeUsername(username) } });
  if (!masterAdmin || masterAdmin.status !== "active") return { status: "generic" };
  if (!masterAdmin.passwordHash || !(await verifyPassword(masterAdmin.passwordHash, password))) return { status: "generic" };
  const accessToken = await signAccessToken({
    sub: masterAdmin.id,
    identityType: "master_admin",
    tokenType: "access",
    username: masterAdmin.username,
  });
  const refreshToken = await signRefreshToken({
    sub: masterAdmin.id,
    identityType: "master_admin",
    tokenType: "refresh",
  });
  await storeRefreshToken({
    masterAdminId: masterAdmin.id,
    familyId: crypto.randomUUID(),
    refreshToken,
    tokenId: crypto.randomUUID(),
  });
  await writeAuthAudit({
    actorType: AUDIT_ACTOR_TYPES.MASTER_ADMIN,
    actorId: masterAdmin.id,
    action: "master_admin.auth.login_succeeded",
    resourceType: "master_admin_session",
    resourceId: masterAdmin.id,
    result: AUDIT_RESULTS.SUCCESS,
  });
  return { masterAdmin, accessToken, refreshToken };
}

export async function refreshMasterAdminSession(refreshToken) {
  const rawToken = normalizeRefreshToken(refreshToken);
  if (!rawToken) return null;
  const tokenHash = hashSecret(rawToken);
  const { payload } = await verifyRefreshToken(rawToken).catch(() => ({ payload: null }));
  if (!payload || payload.identityType !== "master_admin") return null;
  const stored = await prisma.masterAdminRefreshToken.findUnique({ where: { tokenHash } });
  const now = new Date();
  if (!stored) return null;
  if (stored.revokedAt) {
    if (stored.replacedByTokenId && now.getTime() - new Date(stored.revokedAt).getTime() <= REFRESH_HANDOFF_WINDOW_MS) {
      return { status: "retry" };
    }
    return null;
  }
  if (stored.expiresAt < now) return null;
  const masterAdmin = await prisma.masterAdmin.findUnique({ where: { id: payload.sub } });
  if (!masterAdmin || masterAdmin.status !== "active") return null;
  const rotated = await rotateMasterAdminRefreshToken(stored, masterAdmin);
  await writeAuthAudit({
    actorType: AUDIT_ACTOR_TYPES.MASTER_ADMIN,
    actorId: masterAdmin.id,
    action: "master_admin.auth.refresh_succeeded",
    resourceType: "master_admin_session",
    resourceId: masterAdmin.id,
    result: AUDIT_RESULTS.SUCCESS,
  });
  return rotated;
}

export async function logoutMasterAdmin(refreshToken) {
  const rawToken = normalizeRefreshToken(refreshToken);
  if (!rawToken) return;
  const tokenHash = hashSecret(rawToken);
  const result = await prisma.masterAdminRefreshToken.findUnique({ where: { tokenHash } });
  await prisma.masterAdminRefreshToken.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } });
  if (result) {
    await writeAuthAudit({
      actorType: AUDIT_ACTOR_TYPES.MASTER_ADMIN,
      actorId: result.masterAdminId,
      action: "master_admin.auth.logout",
      resourceType: "master_admin_session",
      resourceId: result.masterAdminId,
      result: AUDIT_RESULTS.SUCCESS,
    });
  }
}

export async function getCurrentMasterAdmin(masterAdminId) {
  const masterAdmin = await prisma.masterAdmin.findUnique({ where: { id: masterAdminId } });
  if (!masterAdmin || masterAdmin.status !== "active") return null;
  return {
    id: masterAdmin.id,
    username: masterAdmin.username,
    email: masterAdmin.email,
    status: masterAdmin.status,
    createdAt: masterAdmin.createdAt,
    updatedAt: masterAdmin.updatedAt,
  };
}

export const masterAdminAuthCookieNames = {
  refreshToken: REFRESH_COOKIE_NAME,
  csrfToken: CSRF_COOKIE_NAME,
};

export function setMasterAdminAuthCookies(res, refreshToken, csrfToken) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, cookieOptions(7 * 24 * 60 * 60 * 1000));
  res.cookie(CSRF_COOKIE_NAME, csrfToken, { ...cookieOptions(7 * 24 * 60 * 60 * 1000), httpOnly: false });
}

export function clearMasterAdminAuthCookies(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions(0));
  res.clearCookie(CSRF_COOKIE_NAME, { ...cookieOptions(0), httpOnly: false });
}
