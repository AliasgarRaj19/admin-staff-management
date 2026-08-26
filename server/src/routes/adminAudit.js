import { Router } from "express";
import { requireMasterAdminAuth } from "../middleware/masterAdminAuth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.use(requireMasterAdminAuth);

router.get("/audit-logs", async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 25)));
  const filters = {};
  for (const key of ["actorType", "actorId", "action", "resourceType", "resourceId", "result"]) {
    const value = String(req.query[key] || "").trim();
    if (value) filters[key] = value;
  }
  const logs = (await prisma.auditLog.findMany({ where: filters }))
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const start = (page - 1) * pageSize;
  const auditLogs = logs.slice(start, start + pageSize);
  res.json({ auditLogs, page, pageSize, total: logs.length });
});

export { router as adminAuditRouter };
