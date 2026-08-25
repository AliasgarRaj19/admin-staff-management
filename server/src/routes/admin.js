import { Router } from "express";
import { requireMasterAdminAuth } from "../middleware/masterAdminAuth.js";
import {
  blockStaffAccount,
  getStaffAccountDetails,
  listStaffAccounts,
  permanentlyDeleteStaffAccount,
  removeStaffAccount,
  restoreStaffAccount,
  unblockStaffAccount,
} from "../services/staffLifecycle.js";
import {
  createRole,
  deleteRole,
  getEffectivePermissions,
  getPermissionRegistry,
  getRoleById,
  listRoles,
  listStaffPermissions,
  listStaffRoles,
  setRolePermissions,
  setStaffPermissions,
  setStaffRoles,
  updateRole,
} from "../services/rbac.js";
import {
  roleManagementSchema,
  rolePermissionUpdateSchema,
  staffPermissionUpdateSchema,
  staffRoleUpdateSchema,
} from "../lib/validators.js";

const router = Router();

function mapLifecycleOutcome(res, result, successStatus = 200) {
  if (!result || result.outcome === "not_found") return res.status(404).json({ message: "Staff account not found" });
  if (result.outcome === "invalid_transition") return res.status(409).json({ message: "Invalid staff lifecycle transition" });
  if (result.outcome === "invalid_confirmation") return res.status(400).json({ message: "Confirmation required" });
  if (successStatus === 204) return res.status(204).end();
  return res.status(successStatus).json(result.staff ? { staff: result.staff } : { ok: true });
}

function mapRoleOutcome(res, result, successStatus = 200) {
  if (!result || result.outcome === "not_found") return res.status(404).json({ message: "Role not found" });
  if (result.outcome === "conflict") return res.status(409).json({ message: "Role cannot be changed in its current state" });
  if (successStatus === 204) return res.status(204).end();
  return res.status(successStatus).json(result.role ? { role: result.role } : { ok: true });
}

function mapStaffAssignmentOutcome(res, result, resourceName) {
  if (!result || result.outcome === "not_found") return res.status(404).json({ message: `${resourceName} not found` });
  return res.json({
    staffId: result.staffId,
    roles: result.roles,
    permissions: result.permissions,
  });
}

function isValidationFailure(error) {
  const message = String(error?.message || "");
  return error?.name === "ZodError" || /required|fewer|array|exist|must be/i.test(message);
}

router.use(requireMasterAdminAuth);

router.get("/permissions", async (_req, res) => {
  const registry = await getPermissionRegistry();
  res.json(registry);
});

router.get("/roles", async (_req, res) => {
  const roles = await listRoles();
  res.json({ roles });
});

router.post("/roles", async (req, res) => {
  try {
    const body = roleManagementSchema.parse(req.body ?? {});
    const result = await createRole({
      actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
      name: body.name,
      description: body.description ?? null,
      permissionIds: body.permissionIds ?? [],
      permissionKeys: body.permissionKeys ?? [],
    });
    return mapRoleOutcome(res, result, 201);
  } catch (error) {
    if (isValidationFailure(error)) return res.status(400).json({ message: "Validation failed" });
    if (String(error?.message || "").includes("referenced permissions")) return res.status(400).json({ message: "One or more referenced permissions do not exist." });
    throw error;
  }
});

router.get("/roles/:id", async (req, res) => {
  const role = await getRoleById(req.params.id);
  if (!role) return res.status(404).json({ message: "Role not found" });
  res.json({ role });
});

router.patch("/roles/:id", async (req, res) => {
  try {
    const body = roleManagementSchema.parse(req.body ?? {});
    const result = await updateRole({
      roleId: req.params.id,
      actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
      name: body.name,
      description: body.description ?? null,
      permissionIds: body.permissionIds ?? [],
      permissionKeys: body.permissionKeys ?? [],
    });
    return mapRoleOutcome(res, result);
  } catch (error) {
    if (isValidationFailure(error)) return res.status(400).json({ message: "Validation failed" });
    if (String(error?.message || "").includes("referenced permissions")) return res.status(400).json({ message: "One or more referenced permissions do not exist." });
    throw error;
  }
});

router.delete("/roles/:id", async (req, res) => {
  const result = await deleteRole({
    roleId: req.params.id,
    actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
  });
  return mapRoleOutcome(res, result, 204);
});

router.put("/roles/:id/permissions", async (req, res) => {
  try {
    const body = rolePermissionUpdateSchema.parse(req.body ?? {});
    const result = await setRolePermissions({
      roleId: req.params.id,
      actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
      permissionIds: body.permissionIds ?? [],
      permissionKeys: body.permissionKeys ?? [],
    });
    return mapRoleOutcome(res, result);
  } catch (error) {
    if (isValidationFailure(error)) return res.status(400).json({ message: "Validation failed" });
    if (String(error?.message || "").includes("referenced permissions")) return res.status(400).json({ message: "One or more referenced permissions do not exist." });
    throw error;
  }
});

router.get("/staff", async (req, res) => {
  try {
    const status = String(req.query.status || "active").trim();
    const staff = await listStaffAccounts({ status });
    res.json({ staff });
  } catch {
    res.status(400).json({ message: "Invalid staff status filter" });
  }
});

router.get("/staff/:id/effective-permissions", async (req, res) => {
  const staff = await getStaffAccountDetails(req.params.id);
  if (!staff) return res.status(404).json({ message: "Staff account not found" });
  const permissions = await getEffectivePermissions(req.params.id);
  res.json({ staffId: req.params.id, permissions });
});

router.get("/staff/:id/roles", async (req, res) => {
  const staff = await getStaffAccountDetails(req.params.id);
  if (!staff) return res.status(404).json({ message: "Staff account not found" });
  const roles = await listStaffRoles(req.params.id);
  res.json({ staffId: req.params.id, roles });
});

router.put("/staff/:id/roles", async (req, res) => {
  try {
    const body = staffRoleUpdateSchema.parse(req.body ?? {});
    const result = await setStaffRoles({
      staffAccountId: req.params.id,
      actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
      roleIds: body.roleIds ?? [],
    });
    return mapStaffAssignmentOutcome(res, result, "Staff account");
  } catch (error) {
    if (isValidationFailure(error)) return res.status(400).json({ message: "Validation failed" });
    if (String(error?.message || "").includes("referenced roles")) return res.status(400).json({ message: "One or more referenced roles do not exist." });
    throw error;
  }
});

router.get("/staff/:id/permissions", async (req, res) => {
  const staff = await getStaffAccountDetails(req.params.id);
  if (!staff) return res.status(404).json({ message: "Staff account not found" });
  const permissions = await listStaffPermissions(req.params.id);
  res.json({ staffId: req.params.id, permissions });
});

router.put("/staff/:id/permissions", async (req, res) => {
  try {
    const body = staffPermissionUpdateSchema.parse(req.body ?? {});
    const result = await setStaffPermissions({
      staffAccountId: req.params.id,
      actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
      permissionIds: body.permissionIds ?? [],
      permissionKeys: body.permissionKeys ?? [],
    });
    return mapStaffAssignmentOutcome(res, result, "Staff account");
  } catch (error) {
    if (isValidationFailure(error)) return res.status(400).json({ message: "Validation failed" });
    if (String(error?.message || "").includes("referenced permissions")) return res.status(400).json({ message: "One or more referenced permissions do not exist." });
    throw error;
  }
});

router.get("/staff/:id", async (req, res) => {
  const staff = await getStaffAccountDetails(req.params.id);
  if (!staff) return res.status(404).json({ message: "Staff account not found" });
  res.json({ staff });
});

router.post("/staff/:id/block", async (req, res) => {
  const result = await blockStaffAccount({
    staffAccountId: req.params.id,
    actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
  });
  return mapLifecycleOutcome(res, result);
});

router.post("/staff/:id/unblock", async (req, res) => {
  const result = await unblockStaffAccount({
    staffAccountId: req.params.id,
    actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
  });
  return mapLifecycleOutcome(res, result);
});

router.post("/staff/:id/remove", async (req, res) => {
  const result = await removeStaffAccount({
    staffAccountId: req.params.id,
    actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
  });
  return mapLifecycleOutcome(res, result);
});

router.post("/staff/:id/restore", async (req, res) => {
  const result = await restoreStaffAccount({
    staffAccountId: req.params.id,
    actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
  });
  return mapLifecycleOutcome(res, result);
});

router.delete("/staff/:id", async (req, res) => {
  if (req.body?.confirm !== "DELETE") {
    return res.status(400).json({ message: "Confirmation required" });
  }
  const result = await permanentlyDeleteStaffAccount({
    staffAccountId: req.params.id,
    actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
    confirm: req.body.confirm,
  });
  return mapLifecycleOutcome(res, result, 204);
});

export { router as adminRouter };
