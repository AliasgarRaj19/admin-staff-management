import { Router } from "express";
import { requireStaffAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permissions.js";

const router = Router();

router.get("/pages", requireStaffAuth, requirePermission("pages.read"), (_req, res) => {
  res.json({ ok: true, message: "You have been granted access." });
});

router.get("/pages/edit", requireStaffAuth, requirePermission("pages.edit"), (_req, res) => {
  res.json({ ok: true, message: "You have been granted access." });
});

router.get("/pages/create", requireStaffAuth, requirePermission("pages.create"), (_req, res) => {
  res.json({ ok: true, message: "You have been granted access." });
});

router.get("/:permissionKey", requireStaffAuth, async (req, res) => {
  const permissionKey = String(req.params.permissionKey || "").trim();
  if (!permissionKey) {
    return res.status(404).json({ message: "Not found" });
  }
  return requirePermission(permissionKey)(req, res, () => {
    res.json({ ok: true, message: "You have been granted access.", permissionKey });
  });
});

export { router as staffAccessRouter };
