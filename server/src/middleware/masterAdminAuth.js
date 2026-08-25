import { verifyAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

export async function requireMasterAdminAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const { payload } = await verifyAccessToken(token);
    if (payload.identityType !== "master_admin" || payload.tokenType !== "access") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const masterAdmin = await prisma.masterAdmin.findUnique({ where: { id: payload.sub } });
    if (!masterAdmin || masterAdmin.status !== "active") {
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.auth = payload;
    req.masterAdmin = masterAdmin;
    next();
  } catch {
    res.status(401).json({ message: "Unauthorized" });
  }
}
