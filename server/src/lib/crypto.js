import crypto from "node:crypto";
import argon2 from "argon2";

export const ARGON2_TYPE = argon2.argon2id;

export async function hashPassword(password) {
  return argon2.hash(String(password), { type: ARGON2_TYPE });
}

export async function verifyPassword(hash, password) {
  return argon2.verify(hash, String(password), { type: ARGON2_TYPE });
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
