import { AUDIT_ACTOR_TYPES, AUDIT_RESULTS } from "../domain/audit.js";
import { prisma } from "../lib/prisma.js";

const LIFECYCLE_STATUSES = new Set(["active", "blocked", "removed"]);
const STAFF_LIFECYCLE_AUDIT_RESOURCE = "staff_account";

function publicStaffView(staff) {
  if (!staff) return null;
  return {
    id: staff.id,
    email: staff.email,
    firstName: staff.firstName,
    lastName: staff.lastName,
    phone: staff.phone,
    roleName: staff.roleName,
    status: staff.status,
    createdAt: staff.createdAt,
    updatedAt: staff.updatedAt,
    invitedAt: staff.invitedAt,
    registeredAt: staff.registeredAt,
    activatedAt: staff.activatedAt,
    blockedAt: staff.blockedAt,
    removedAt: staff.removedAt,
  };
}

function resolveActor(actor) {
  return {
    actorType: actor?.actorType || AUDIT_ACTOR_TYPES.SYSTEM,
    actorId: actor?.actorId || null,
  };
}

async function writeAudit(tx, { actor, action, target, result, metadata }) {
  const resolvedActor = resolveActor(actor);
  await tx.auditLog.create({
    data: {
      actorType: resolvedActor.actorType,
      actorId: resolvedActor.actorId,
      actorStaffAccountId: resolvedActor.actorType === AUDIT_ACTOR_TYPES.STAFF ? resolvedActor.actorId : null,
      action,
      resourceType: STAFF_LIFECYCLE_AUDIT_RESOURCE,
      resourceId: target?.id || null,
      result,
      metadata: metadata || null,
      ipAddress: null,
      userAgent: null,
    },
  });
}

function buildLifecycleMetadata({ target, previousStatus, nextStatus, revokedSessionCount = 0, reason = null }) {
  return {
    staffAccountId: target?.id || null,
    roleName: target?.roleName || null,
    previousStatus,
    nextStatus,
    revokedSessionCount,
    ...(reason ? { reason } : {}),
  };
}

async function revokeAllStaffSessions(tx, staffAccountId) {
  const now = new Date();
  const result = await tx.staffRefreshToken.updateMany({
    where: { staffAccountId, revokedAt: null },
    data: { revokedAt: now },
  });
  return { revokedAt: now, count: result.count };
}

async function transitionStaffStatus({ staffAccountId, expectedStatus, nextStatus, action, actor }) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const target = await tx.staffAccount.findUnique({ where: { id: staffAccountId } });
    if (!target) {
      return { outcome: "not_found" };
    }
    if (target.status !== expectedStatus) {
      await writeAudit(tx, {
        actor,
        action: "staff.lifecycle.invalid_transition",
        target,
        result: AUDIT_RESULTS.DENIED,
        metadata: buildLifecycleMetadata({
          target,
          previousStatus: target.status,
          nextStatus,
          reason: `expected ${expectedStatus}`,
        }),
      });
      return { outcome: "invalid_transition", target: publicStaffView(target) };
    }

    const updateData = {
      status: nextStatus,
      updatedAt: now,
      blockedAt: null,
      removedAt: null,
    };
    if (nextStatus === "blocked") updateData.blockedAt = now;
    if (nextStatus === "removed") updateData.removedAt = now;
    if (nextStatus === "active") {
      updateData.blockedAt = null;
      updateData.removedAt = null;
    }

    const updateResult = await tx.staffAccount.updateMany({
      where: { id: staffAccountId, status: expectedStatus },
      data: updateData,
    });

    if (!updateResult.count) {
      const current = await tx.staffAccount.findUnique({ where: { id: staffAccountId } });
      return { outcome: "invalid_transition", target: publicStaffView(current) };
    }

    const revoked = await revokeAllStaffSessions(tx, staffAccountId);
    const updated = await tx.staffAccount.findUnique({ where: { id: staffAccountId } });
    await writeAudit(tx, {
      actor,
      action,
      target: updated,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: buildLifecycleMetadata({
        target: updated,
        previousStatus: expectedStatus,
        nextStatus,
        revokedSessionCount: revoked.count,
      }),
    });
    return { outcome: "ok", staff: publicStaffView(updated), revokedSessionCount: revoked.count };
  });
}

export async function listStaffAccounts({ status = "active" } = {}) {
  if (!LIFECYCLE_STATUSES.has(status)) {
    throw new Error("Invalid staff status filter.");
  }
  const rows = await prisma.staffAccount.findMany({ where: { status } });
  return rows
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .map(publicStaffView);
}

export async function getStaffAccountDetails(staffAccountId) {
  const staff = await prisma.staffAccount.findUnique({ where: { id: staffAccountId } });
  return staff ? publicStaffView(staff) : null;
}

export async function blockStaffAccount({ staffAccountId, actor }) {
  return transitionStaffStatus({
    staffAccountId,
    expectedStatus: "active",
    nextStatus: "blocked",
    action: "staff.lifecycle.blocked",
    actor,
  });
}

export async function unblockStaffAccount({ staffAccountId, actor }) {
  return transitionStaffStatus({
    staffAccountId,
    expectedStatus: "blocked",
    nextStatus: "active",
    action: "staff.lifecycle.unblocked",
    actor,
  });
}

export async function removeStaffAccount({ staffAccountId, actor }) {
  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.staffAccount.findUnique({ where: { id: staffAccountId } });
    if (!target) return { outcome: "not_found" };
    if (!["active", "blocked"].includes(target.status)) {
      await writeAudit(tx, {
        actor,
        action: "staff.lifecycle.invalid_transition",
        target,
        result: AUDIT_RESULTS.DENIED,
        metadata: buildLifecycleMetadata({
          target,
          previousStatus: target.status,
          nextStatus: "removed",
          reason: "expected active or blocked",
        }),
      });
      return { outcome: "invalid_transition", target: publicStaffView(target) };
    }

    const updateResult = await tx.staffAccount.updateMany({
      where: { id: staffAccountId, status: target.status },
      data: {
        status: "removed",
        removedAt: new Date(),
        blockedAt: null,
        updatedAt: new Date(),
      },
    });
    if (!updateResult.count) {
      const current = await tx.staffAccount.findUnique({ where: { id: staffAccountId } });
      return { outcome: "invalid_transition", target: publicStaffView(current) };
    }

    const revoked = await revokeAllStaffSessions(tx, staffAccountId);
    const updated = await tx.staffAccount.findUnique({ where: { id: staffAccountId } });
    await writeAudit(tx, {
      actor,
      action: "staff.lifecycle.removed",
      target: updated,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: buildLifecycleMetadata({
        target: updated,
        previousStatus: target.status,
        nextStatus: "removed",
        revokedSessionCount: revoked.count,
      }),
    });
    return { outcome: "ok", staff: publicStaffView(updated), revokedSessionCount: revoked.count };
  });
  return result;
}

export async function restoreStaffAccount({ staffAccountId, actor }) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.staffAccount.findUnique({ where: { id: staffAccountId } });
    if (!target) return { outcome: "not_found" };
    if (target.status !== "removed") {
      await writeAudit(tx, {
        actor,
        action: "staff.lifecycle.invalid_transition",
        target,
        result: AUDIT_RESULTS.DENIED,
        metadata: buildLifecycleMetadata({
          target,
          previousStatus: target.status,
          nextStatus: "active",
          reason: "expected removed",
        }),
      });
      return { outcome: "invalid_transition", target: publicStaffView(target) };
    }

    const updateResult = await tx.staffAccount.updateMany({
      where: { id: staffAccountId, status: "removed" },
      data: {
        status: "active",
        removedAt: null,
        blockedAt: null,
        updatedAt: new Date(),
      },
    });
    if (!updateResult.count) {
      const current = await tx.staffAccount.findUnique({ where: { id: staffAccountId } });
      return { outcome: "invalid_transition", target: publicStaffView(current) };
    }

    const updated = await tx.staffAccount.findUnique({ where: { id: staffAccountId } });
    await writeAudit(tx, {
      actor,
      action: "staff.lifecycle.restored",
      target: updated,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: buildLifecycleMetadata({
        target: updated,
        previousStatus: "removed",
        nextStatus: "active",
      }),
    });
    return { outcome: "ok", staff: publicStaffView(updated) };
  });
}

export async function permanentlyDeleteStaffAccount({ staffAccountId, actor, confirm }) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.staffAccount.findUnique({ where: { id: staffAccountId } });
    await writeAudit(tx, {
      actor,
      action: "staff.lifecycle.permanent_delete_attempt",
      target,
      result: confirm === "DELETE" ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.DENIED,
      metadata: buildLifecycleMetadata({
        target,
        previousStatus: target?.status || null,
        nextStatus: "deleted",
        reason: confirm === "DELETE" ? null : "confirmation required",
      }),
    });
    if (confirm !== "DELETE") {
      return { outcome: "invalid_confirmation" };
    }
    if (!target) {
      return { outcome: "not_found" };
    }
    if (target.status !== "removed") {
      await writeAudit(tx, {
        actor,
        action: "staff.lifecycle.invalid_transition",
        target,
        result: AUDIT_RESULTS.DENIED,
        metadata: buildLifecycleMetadata({
          target,
          previousStatus: target.status,
          nextStatus: "deleted",
          reason: "expected removed",
        }),
      });
      return { outcome: "invalid_transition", target: publicStaffView(target) };
    }

    const deleteResult = await tx.staffAccount.deleteMany({ where: { id: staffAccountId, status: "removed" } });
    if (!deleteResult.count) {
      const current = await tx.staffAccount.findUnique({ where: { id: staffAccountId } });
      return { outcome: "invalid_transition", target: publicStaffView(current) };
    }

    await writeAudit(tx, {
      actor,
      action: "staff.lifecycle.permanent_deleted",
      target: { id: staffAccountId, roleName: target.roleName, status: target.status },
      result: AUDIT_RESULTS.SUCCESS,
      metadata: buildLifecycleMetadata({
        target,
        previousStatus: target.status,
        nextStatus: "deleted",
      }),
    });
    return { outcome: "deleted", staffId: staffAccountId };
  });
}
