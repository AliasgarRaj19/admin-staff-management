export const MAX_RBAC_ROLE_NAME_LENGTH = 80;
export const MAX_RBAC_ROLE_DESCRIPTION_LENGTH = 240;

export function normalizeRbacRoleName(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error("Role name is required.");
  }
  if (normalized.length > MAX_RBAC_ROLE_NAME_LENGTH) {
    throw new Error(`Role name must be ${MAX_RBAC_ROLE_NAME_LENGTH} characters or fewer.`);
  }
  return normalized;
}

export function normalizeRbacRoleDescription(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (normalized.length > MAX_RBAC_ROLE_DESCRIPTION_LENGTH) {
    throw new Error(`Role description must be ${MAX_RBAC_ROLE_DESCRIPTION_LENGTH} characters or fewer.`);
  }
  return normalized;
}

export function normalizePermissionKey(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    throw new Error("Permission key is required.");
  }
  return normalized;
}

export function normalizePermissionKeys(values = []) {
  if (!Array.isArray(values)) {
    throw new Error("Permission list must be an array.");
  }
  return [...new Set(values.map(normalizePermissionKey))];
}

export function groupPermissionsByModule(permissions = []) {
  return permissions.reduce((accumulator, permission) => {
    const moduleName = String(permission.module || "unknown");
    if (!accumulator[moduleName]) accumulator[moduleName] = [];
    accumulator[moduleName].push(permission);
    return accumulator;
  }, {});
}
