import { Router } from "express";

const router = Router();

router.get("/me", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

export { router as adminRouter };
