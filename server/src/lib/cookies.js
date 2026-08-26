import crypto from "node:crypto";
import { env } from "../config/env.js";

export const csrfCookieNames = {
  staff: "staffCsrfToken",
  masterAdmin: "masterAdminCsrfToken",
};

export function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.NODE_ENV === "production" ? "strict" : "lax",
    path: "/",
    maxAge: maxAgeMs,
  };
}

export function clearCookieOptions() {
  const { maxAge, ...options } = cookieOptions(0);
  return { ...options, maxAge: 0 };
}

export function newCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function requireCsrf(sessionKind = "staff") {
  const cookieName = csrfCookieNames[sessionKind] || csrfCookieNames.staff;
  return (req, res, next) => {
    const cookieToken = req.cookies[cookieName];
    const headerToken = req.header("x-csrf-token");
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return res.status(403).json({ message: "CSRF validation failed" });
    }
    next();
  };
}
