import { Router } from "express";
import { rateLimit, rateLimitPresets } from "../lib/limiter.js";
import { newCsrfToken } from "../lib/cookies.js";
import {
  clearMasterAdminAuthCookies,
  getCurrentMasterAdmin,
  loginMasterAdmin,
  logoutMasterAdmin,
  masterAdminAuthCookieNames,
  refreshMasterAdminSession,
  setMasterAdminAuthCookies,
} from "../services/masterAdminAuth.js";
import { requireMasterAdminAuth } from "../middleware/masterAdminAuth.js";

const router = Router();

router.post("/login", rateLimit((req) => `master-admin-login:${req.ip}`, rateLimitPresets.adminLogin), async (req, res) => {
  const username = String(req.body?.username ?? req.body?.email ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!username || !password) return res.status(400).json({ message: "Validation failed" });
  const result = await loginMasterAdmin(username, password);
  if (result.status) return res.status(401).json({ message: "Invalid credentials or account state" });
  const csrfToken = newCsrfToken();
  setMasterAdminAuthCookies(res, result.refreshToken, csrfToken);
  res.json({
    accessToken: result.accessToken,
    csrfToken,
    user: {
      id: result.masterAdmin.id,
      username: result.masterAdmin.username,
      email: result.masterAdmin.email,
      status: result.masterAdmin.status,
    },
  });
});

router.post("/refresh", rateLimit((req) => `master-admin-refresh:${req.ip}`, rateLimitPresets.staffRefresh), async (req, res) => {
  const result = await refreshMasterAdminSession(req.cookies[masterAdminAuthCookieNames.refreshToken]);
  if (!result) return res.status(401).json({ message: "Unauthorized" });
  if (result.status === "retry") return res.status(409).json({ message: "REFRESH_RETRY" });
  const csrfToken = newCsrfToken();
  setMasterAdminAuthCookies(res, result.refreshToken, csrfToken);
  res.json({ accessToken: result.accessToken, csrfToken, user: result.user });
});

router.post("/logout", rateLimit((req) => `master-admin-logout:${req.ip}`, rateLimitPresets.staffLogout), async (req, res) => {
  if (req.cookies[masterAdminAuthCookieNames.refreshToken]) {
    await logoutMasterAdmin(req.cookies[masterAdminAuthCookieNames.refreshToken]);
  }
  clearMasterAdminAuthCookies(res);
  res.json({ ok: true });
});

router.get("/me", requireMasterAdminAuth, async (req, res) => {
  const masterAdmin = await getCurrentMasterAdmin(req.masterAdmin.id);
  if (!masterAdmin) return res.status(401).json({ message: "Unauthorized" });
  res.json({ user: masterAdmin });
});

export { router as masterAdminAuthRouter };
