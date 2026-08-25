import { verifyAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

export async function requireStaffAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const { payload } = await verifyAccessToken(token);
    if (payload.identityType !== "staff") return res.status(401).json({ message: "Unauthorized" });
    const staff = await prisma.staffAccount.findUnique({ where: { id: payload.sub } });
    if (!staff || staff.status !== "active") return res.status(401).json({ message: "Unauthorized" });
    req.auth = payload;
    req.staff = staff;
    next();
  } catch {
    res.status(401).json({ message: "Unauthorized" });
  }
}
