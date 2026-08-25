import { createHash, randomBytes } from "node:crypto";

export function generateOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function hoursFromNow(hours, now = new Date()) {
  return new Date(now.valueOf() + hours * 60 * 60 * 1000);
}
