import { Router } from "express";
import { requireStaffAuth } from "../middleware/auth.js";

const router = Router();

router.get("/me", requireStaffAuth, async (req, res) => {
  res.json({ user: req.staff });
});

export { router as userRouter };
