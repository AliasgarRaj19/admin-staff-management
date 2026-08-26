import { Router } from "express";
import { requireCsrf } from "../lib/cookies.js";
import { requireStaffAuth } from "../middleware/auth.js";
import { changeStaffPassword } from "../services/auth.js";

const router = Router();

router.get("/me", requireStaffAuth, async (req, res) => {
  res.json({ user: req.staff });
});

router.post("/change-password", requireStaffAuth, requireCsrf("staff"), async (req, res) => {
  try {
    const result = await changeStaffPassword({
      staffId: req.staff.id,
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword,
      confirmNewPassword: req.body?.repeatNewPassword ?? req.body?.confirmNewPassword,
    });
    if (result.status === "unauthorized") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (result.status === "invalid_current_password") {
      return res.status(400).json({ message: "Current password is incorrect." });
    }
    res.json({ ok: true, message: "Password changed successfully." });
  } catch (error) {
    res.status(400).json({ message: String(error?.message || "Failed to change password") });
  }
});

export { router as userRouter };
