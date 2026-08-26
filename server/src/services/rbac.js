import { AUDIT_ACTOR_TYPES, AUDIT_RESULTS } from "../domain/audit.js";
import { groupPermissionsByModule, normalizePermissionKeys, normalizeRbacRoleDescription, normalizeRbacRoleName } from "../domain/rbac.js";
import { prisma } from "../lib/prisma.js";
import { buildAuditEvent, recordAuditEvent } from "../lib/audit.js";

function sortByKey(left, right) {
  return String(left.key || "").localeCompare(String(right.key || ""));
}

function sortByName(left, right) {
  return String(left.name || "").localeCompare(String(right.name || ""));
}

function publicPermission(permission) {
  return {
    id: permission.id,
    key: permission.key,
    displayName: permission.displayName,
    description: permission.description,
    module: permission.module,
    createdAt: permission.createdAt,
    updatedAt: permission.updatedAt,
  };
}

function publicRole(role, permissions = [], staffCount = 0) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    permissionKeys: [...permissions.map((permission) => permission.key)].sort(),
    staffCount,
  };
}

async function writeAudit(tx, event) {
  await recordAuditEvent(tx, buildAuditEvent({
    actorType: event.actorType ?? AUDIT_ACTOR_TYPES.SYSTEM,
    actorId: event.actorId ?? null,
    actorStaffAccountId: event.actorStaffAccountId ?? null,
    action: event.action,
    resourceType: event.resourceType ?? null,
    resourceId: event.resourceId ?? null,
    result: event.result ?? AUDIT_RESULTS.SUCCESS,
    metadata: event.metadata ?? null,
    ipAddress: event.ipAddress ?? null,
    userAgent: event.userAgent ?? null,
  }));
}

async function loadPermissionLookup(db = prisma) {
  const permissions = await db.permission.findMany();
  return new Map(permissions.map((permission) => [permission.id, permission]));
}

async function summarizeRole(db, role) {
  const rolePermissions = await db.rolePermission.findMany({ where: { roleId: role.id } });
  const staffCount = await db.staffRole.count({ where: { roleId: role.id } });
  const permissionLookup = await loadPermissionLookup(db);
  const permissions = rolePermissions
    .map((row) => permissionLookup.get(row.permissionId))
    .filter(Boolean)
    .sort(sortByKey);
  return publicRole(role, permissions, staffCount);
}

async function summarizeStaffRoles(db, staffAccountId) {
  const links = await db.staffRole.findMany({ where: { staffAccountId } });
  const roles = await db.role.findMany();
  const roleById = new Map(roles.map((role) => [role.id, role]));
  return links
    .map((link) => roleById.get(link.roleId))
    .filter(Boolean)
    .sort(sortByName)
    .map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    }));
}

async function summarizeStaffPermissions(db, staffAccountId) {
  const links = await db.staffPermission.findMany({ where: { staffAccountId } });
  const permissions = await db.permission.findMany();
  const permissionById = new Map(permissions.map((permission) => [permission.id, permission]));
  return links
    .map((link) => permissionById.get(link.permissionId))
    .filter(Boolean)
    .sort(sortByKey)
    .map(publicPermission);
}

async function resolvePermissions(db, identifiers = []) {
  const normalized = normalizePermissionKeys(identifiers);
  const permissions = await db.permission.findMany();
  const byId = new Map(permissions.map((permission) => [permission.id, permission]));
  const byKey = new Map(permissions.map((permission) => [permission.key, permission]));
  const resolved = normalized.map((identifier) => byId.get(identifier) ?? byKey.get(identifier)).filter(Boolean);
  if (resolved.length !== normalized.length) {
    throw new Error("One or more referenced permissions do not exist.");
  }
  return [...new Map(resolved.map((permission) => [permission.id, permission])).values()];
}

async function resolveRoles(db, roleIds = []) {
  if (!Array.isArray(roleIds)) throw new Error("Role list must be an array.");
  const uniqueRoleIds = [...new Set(roleIds.map((roleId) => String(roleId ?? "").trim()).filter(Boolean))];
  const roles = await db.role.findMany();
  const byId = new Map(roles.map((role) => [role.id, role]));
  const resolved = uniqueRoleIds.map((roleId) => byId.get(roleId)).filter(Boolean);
  if (resolved.length !== uniqueRoleIds.length) {
    throw new Error("One or more referenced roles do not exist.");
  }
  return resolved;
}

function buildRegistryGroups(permissions) {
  const grouped = groupPermissionsByModule(permissions);
  return Object.keys(grouped)
    .sort()
    .reduce((accumulator, moduleName) => {
      accumulator[moduleName] = grouped[moduleName].sort(sortByKey).map(publicPermission);
      return accumulator;
    }, {});
}

export async function getPermissionRegistry() {
  const permissions = (await prisma.permission.findMany()).sort(sortByKey);
  return {
    count: permissions.length,
    permissions: permissions.map(publicPermission),
    groups: buildRegistryGroups(permissions),
  };
}

export async function listRoles() {
  const roles = (await prisma.role.findMany()).sort(sortByName);
  const result = [];
  for (const role of roles) {
    result.push(await summarizeRole(prisma, role));
  }
  return result;
}

export async function getRoleById(roleId) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) return null;
  return summarizeRole(prisma, role);
}

export async function createRole({ actor, name, description = null, permissionIds = [], permissionKeys = [] }) {
  const normalizedName = normalizeRbacRoleName(name);
  const normalizedDescription = normalizeRbacRoleDescription(description);
  const identifiers = [...permissionIds, ...permissionKeys];
  return prisma.$transaction(async (tx) => {
    const existing = await tx.role.findUnique({ where: { name: normalizedName } });
    if (existing) return { outcome: "conflict" };
    const permissions = await resolvePermissions(tx, identifiers);
    const role = await tx.role.create({
      data: {
        name: normalizedName,
        description: normalizedDescription,
        isSystem: false,
      },
    });
    if (permissions.length) {
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
        skipDuplicates: true,
      });
    }
    const summary = await summarizeRole(tx, role);
    await writeAudit(tx, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "permissions.role.created",
      resourceType: "role",
      resourceId: role.id,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: {
        roleId: role.id,
        roleName: summary.name,
        description: summary.description,
        permissionKeys: summary.permissionKeys,
      },
    });
    return { outcome: "ok", role: summary };
  });
}

export async function updateRole({ roleId, actor, name, description = null }) {
  const normalizedName = normalizeRbacRoleName(name);
  const normalizedDescription = normalizeRbacRoleDescription(description);
  return prisma.$transaction(async (tx) => {
    const current = await tx.role.findUnique({ where: { id: roleId } });
    if (!current) return { outcome: "not_found" };
    const duplicate = await tx.role.findUnique({ where: { name: normalizedName } });
    if (duplicate && duplicate.id !== roleId) return { outcome: "conflict" };
    await tx.role.update({
      where: { id: roleId },
      data: {
        name: normalizedName,
        description: normalizedDescription,
        updatedAt: new Date(),
      },
    });
    const updated = await tx.role.findUnique({ where: { id: roleId } });
    const summary = await summarizeRole(tx, updated);
    await writeAudit(tx, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "permissions.role.updated",
      resourceType: "role",
      resourceId: roleId,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: {
        roleId,
        previous: {
          name: current.name,
          description: current.description,
        },
        next: {
          name: summary.name,
          description: summary.description,
        },
        permissionKeys: summary.permissionKeys,
      },
    });
    return { outcome: "ok", role: summary };
  });
}

export async function deleteRole({ roleId, actor }) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.role.findUnique({ where: { id: roleId } });
    if (!current) return { outcome: "not_found" };
    const assignedCount = await tx.staffRole.count({ where: { roleId } });
    if (assignedCount > 0) {
      await writeAudit(tx, {
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: "permissions.role.deleted",
        resourceType: "role",
        resourceId: roleId,
        result: AUDIT_RESULTS.DENIED,
        metadata: {
          roleId,
          roleName: current.name,
          assignedStaffCount: assignedCount,
        },
      });
      return { outcome: "conflict" };
    }
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.role.deleteMany({ where: { id: roleId } });
    await writeAudit(tx, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "permissions.role.deleted",
      resourceType: "role",
      resourceId: roleId,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: {
        roleId,
        roleName: current.name,
      },
    });
    return { outcome: "ok" };
  });
}

export async function setRolePermissions({ roleId, actor, permissionIds = [], permissionKeys = [] }) {
  const identifiers = [...permissionIds, ...permissionKeys];
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findUnique({ where: { id: roleId } });
    if (!role) return { outcome: "not_found" };
    const permissions = await resolvePermissions(tx, identifiers);
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (permissions.length) {
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId, permissionId: permission.id })),
        skipDuplicates: true,
      });
    }
    const updated = await tx.role.findUnique({ where: { id: roleId } });
    const summary = await summarizeRole(tx, updated);
    await writeAudit(tx, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "permissions.role.permissions_updated",
      resourceType: "role",
      resourceId: roleId,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: {
        roleId,
        roleName: role.name,
        permissionKeys: summary.permissionKeys,
      },
    });
    return { outcome: "ok", role: summary };
  });
}

export async function listStaffRoles(staffAccountId) {
  return summarizeStaffRoles(prisma, staffAccountId);
}

export async function setStaffRoles({ staffAccountId, actor, roleIds = [] }) {
  return prisma.$transaction(async (tx) => {
    const staff = await tx.staffAccount.findUnique({ where: { id: staffAccountId } });
    if (!staff) return { outcome: "not_found" };
    const roles = await resolveRoles(tx, roleIds);
    await tx.staffRole.deleteMany({ where: { staffAccountId } });
    if (roles.length) {
      await tx.staffRole.createMany({
        data: roles.map((role) => ({ staffAccountId, roleId: role.id })),
        skipDuplicates: true,
      });
    }
    const summary = await summarizeStaffRoles(tx, staffAccountId);
    await writeAudit(tx, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "permissions.staff.roles_updated",
      resourceType: "staff_account",
      resourceId: staffAccountId,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: {
        staffAccountId,
        roleIds: summary.map((role) => role.id),
      },
    });
    return { outcome: "ok", staffId: staffAccountId, roles: summary };
  });
}

export async function listStaffPermissions(staffAccountId) {
  return summarizeStaffPermissions(prisma, staffAccountId);
}

export async function setStaffPermissions({ staffAccountId, actor, permissionIds = [], permissionKeys = [] }) {
  const identifiers = [...permissionIds, ...permissionKeys];
  return prisma.$transaction(async (tx) => {
    const staff = await tx.staffAccount.findUnique({ where: { id: staffAccountId } });
    if (!staff) return { outcome: "not_found" };
    const permissions = await resolvePermissions(tx, identifiers);
    await tx.staffPermission.deleteMany({ where: { staffAccountId } });
    if (permissions.length) {
      await tx.staffPermission.createMany({
        data: permissions.map((permission) => ({
          staffAccountId,
          permissionId: permission.id,
          grantedById: actor.actorType === AUDIT_ACTOR_TYPES.MASTER_ADMIN ? null : actor.actorId,
        })),
        skipDuplicates: true,
      });
    }
    const summary = await summarizeStaffPermissions(tx, staffAccountId);
    await writeAudit(tx, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "permissions.staff.direct_permissions_updated",
      resourceType: "staff_account",
      resourceId: staffAccountId,
      result: AUDIT_RESULTS.SUCCESS,
      metadata: {
        staffAccountId,
        permissionKeys: summary.map((permission) => permission.key),
      },
    });
    return { outcome: "ok", staffId: staffAccountId, permissions: summary };
  });
}

export async function getEffectivePermissions(staffAccountId) {
  const staffRoles = await prisma.staffRole.findMany({ where: { staffAccountId } });
  const staffPermissions = await prisma.staffPermission.findMany({ where: { staffAccountId } });
  const permissions = await prisma.permission.findMany();
  const rolePermissions = await prisma.rolePermission.findMany();
  const permissionById = new Map(permissions.map((permission) => [permission.id, permission]));
  const roleIds = new Set(staffRoles.map((link) => link.roleId));
  const permissionIds = new Set([
    ...rolePermissions.filter((link) => roleIds.has(link.roleId)).map((link) => link.permissionId),
    ...staffPermissions.map((link) => link.permissionId),
  ]);
  return [...permissionIds]
    .map((permissionId) => permissionById.get(permissionId))
    .filter(Boolean)
    .sort(sortByKey)
    .map(publicPermission);
}

export async function getStaffPermissionsWithSources(staffAccountId) {
  const [effectivePermissions, roles, directPermissions] = await Promise.all([
    getEffectivePermissions(staffAccountId),
    listStaffRoles(staffAccountId),
    listStaffPermissions(staffAccountId),
  ]);
  return {
    staffId: staffAccountId,
    roles,
    directPermissions,
    effectivePermissions,
  };
}

export async function getRoleRegistrySummary() {
  return {
    permissions: await getPermissionRegistry(),
    roles: await listRoles(),
  };
}
