import { Router } from "express";
import { loginSchema } from "../lib/validators.js";
import { rateLimit, rateLimitPresets } from "../lib/limiter.js";
import { clearCookieOptions, cookieOptions, newCsrfToken } from "../lib/cookies.js";
import { getCurrentStaff, loginStaff, logoutStaff, refreshStaffSession } from "../services/auth.js";
import { requireStaffAuth } from "../middleware/auth.js";

const router = Router();

router.post("/login", rateLimit((req) => `staff-login:${req.ip}`, rateLimitPresets.staffLogin), async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const result = await loginStaff(email, password);
  if (result.status) return res.status(401).json({ message: "Invalid credentials or account state" });
  const csrfToken = newCsrfToken();
  res.cookie("refreshToken", result.refreshToken, cookieOptions(7 * 24 * 60 * 60 * 1000));
  res.cookie("csrfToken", csrfToken, { ...cookieOptions(7 * 24 * 60 * 60 * 1000), httpOnly: false });
  res.json({
    accessToken: result.accessToken,
    csrfToken,
    user: { id: result.staff.id, email: result.staff.email },
  });
});

router.post("/refresh", rateLimit((req) => `staff-refresh:${req.ip}`, rateLimitPresets.staffRefresh), async (req, res) => {
  const result = await refreshStaffSession(req.cookies.refreshToken);
  if (!result) return res.status(401).json({ message: "Unauthorized" });
  if (result.status === "retry") return res.status(409).json({ message: "REFRESH_RETRY" });
  const csrfToken = newCsrfToken();
  res.cookie("refreshToken", result.refreshToken, cookieOptions(7 * 24 * 60 * 60 * 1000));
  res.cookie("csrfToken", csrfToken, { ...cookieOptions(7 * 24 * 60 * 60 * 1000), httpOnly: false });
  res.json({ accessToken: result.accessToken, csrfToken, user: result.user });
});

router.post("/logout", rateLimit((req) => `staff-logout:${req.ip}`, rateLimitPresets.staffLogout), async (req, res) => {
  if (req.cookies.refreshToken) await logoutStaff(req.cookies.refreshToken);
  res.clearCookie("refreshToken", clearCookieOptions());
  res.clearCookie("csrfToken", clearCookieOptions());
  res.json({ ok: true });
});

router.get("/me", requireStaffAuth, async (req, res) => {
  const staff = await getCurrentStaff(req.staff.id);
  if (!staff) return res.status(401).json({ message: "Unauthorized" });
  res.json({ user: staff });
});

export { router as authRouter };
