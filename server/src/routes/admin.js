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

const router = Router();

function mapOutcome(res, result, successStatus = 200) {
  if (!result || result.outcome === "not_found") return res.status(404).json({ message: "Staff account not found" });
  if (result.outcome === "invalid_transition") return res.status(409).json({ message: "Invalid staff lifecycle transition" });
  if (result.outcome === "invalid_confirmation") return res.status(400).json({ message: "Confirmation required" });
  if (successStatus === 204) return res.status(204).end();
  return res.status(successStatus).json(result.staff ? { staff: result.staff } : { ok: true });
}

router.use(requireMasterAdminAuth);

router.get("/staff", async (req, res) => {
  try {
    const status = String(req.query.status || "active").trim();
    const staff = await listStaffAccounts({ status });
    res.json({ staff });
  } catch {
    res.status(400).json({ message: "Invalid staff status filter" });
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
  return mapOutcome(res, result);
});

router.post("/staff/:id/unblock", async (req, res) => {
  const result = await unblockStaffAccount({
    staffAccountId: req.params.id,
    actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
  });
  return mapOutcome(res, result);
});

router.post("/staff/:id/remove", async (req, res) => {
  const result = await removeStaffAccount({
    staffAccountId: req.params.id,
    actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
  });
  return mapOutcome(res, result);
});

router.post("/staff/:id/restore", async (req, res) => {
  const result = await restoreStaffAccount({
    staffAccountId: req.params.id,
    actor: { actorType: "master_admin", actorId: req.masterAdmin.id },
  });
  return mapOutcome(res, result);
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
  return mapOutcome(res, result, 204);
});

export { router as adminRouter };
