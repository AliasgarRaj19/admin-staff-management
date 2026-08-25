import { getEffectivePermissions } from "../services/rbac.js";

function normalizeRequiredPermissions(value) {
  if (Array.isArray(value)) {
    return value.map((permission) => String(permission ?? "").trim()).filter(Boolean);
  }
  return [String(value ?? "").trim()].filter(Boolean);
}

function deny(res) {
  return res.status(403).json({ message: "Forbidden" });
}

export function requirePermission(requiredPermission) {
  const permissions = normalizeRequiredPermissions(requiredPermission);
  return async (req, res, next) => {
    try {
      const effectivePermissions = await getEffectivePermissions(req.staff.id);
      const keys = new Set(effectivePermissions.map((permission) => permission.key));
      if (!permissions.every((permission) => keys.has(permission))) {
        return deny(res);
      }
      req.effectivePermissions = effectivePermissions;
      next();
    } catch {
      deny(res);
    }
  };
}

export function requireAnyPermission(requiredPermissions) {
  const permissions = normalizeRequiredPermissions(requiredPermissions);
  return async (req, res, next) => {
    try {
      const effectivePermissions = await getEffectivePermissions(req.staff.id);
      const keys = new Set(effectivePermissions.map((permission) => permission.key));
      if (!permissions.some((permission) => keys.has(permission))) {
        return deny(res);
      }
      req.effectivePermissions = effectivePermissions;
      next();
    } catch {
      deny(res);
    }
  };
}

export function requireAllPermissions(requiredPermissions) {
  return requirePermission(requiredPermissions);
}
