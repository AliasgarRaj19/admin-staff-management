import crypto from "node:crypto";
import { env } from "../config/env.js";

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

export function requireCsrf(req, res, next) {
  const cookieToken = req.cookies.csrfToken;
  const headerToken = req.header("x-csrf-token");
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ message: "CSRF validation failed" });
  }
  next();
}
