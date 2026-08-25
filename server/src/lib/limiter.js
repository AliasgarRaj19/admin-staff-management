import { env } from "../config/env.js";

const buckets = new Map();

function getEffectiveLimit(limit) {
  if (env.NODE_ENV !== "development") return limit;
  const multiplier = Number(process.env.RATE_LIMIT_DEV_MULTIPLIER || env.RATE_LIMIT_DEV_MULTIPLIER || 20);
  return Math.max(limit, limit * multiplier);
}

function getEffectiveWindowMs(windowMs) {
  if (env.NODE_ENV !== "development") return windowMs;
  return Number(process.env.RATE_LIMIT_DEV_WINDOW_MS || env.RATE_LIMIT_DEV_WINDOW_MS || windowMs);
}

export function rateLimit(keyFn, { limit = 5, windowMs = 60_000 } = {}) {
  const effectiveLimit = getEffectiveLimit(limit);
  const effectiveWindowMs = getEffectiveWindowMs(windowMs);
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const bucket = buckets.get(key) || { count: 0, resetAt: now + effectiveWindowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + effectiveWindowMs;
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > effectiveLimit) {
      return res.status(429).json({ message: "Too many requests. Please try again later." });
    }
    next();
  };
}

export const rateLimitPresets = {
  register: { limit: 5, windowMs: 10 * 60_000 },
  login: { limit: 8, windowMs: 10 * 60_000 },
  adminLogin: { limit: 5, windowMs: 10 * 60_000 },
  resendVerification: { limit: 5, windowMs: 10 * 60_000 },
  forgotPassword: { limit: 5, windowMs: 10 * 60_000 },
  resetPassword: { limit: 5, windowMs: 10 * 60_000 },
  verifyEmail: { limit: 10, windowMs: 10 * 60_000 },
  resetPasswordValidate: { limit: 20, windowMs: 10 * 60_000 },
  refresh: { limit: 350, windowMs: 10 * 60_000 },
  changePassword: { limit: 10, windowMs: 10 * 60_000 },
  staffLogin: { limit: 8, windowMs: 10 * 60_000 },
  staffRefresh: { limit: 350, windowMs: 10 * 60_000 },
  staffLogout: { limit: 20, windowMs: 10 * 60_000 },
};

export function resetLimiterForTests() {
  buckets.clear();
}
