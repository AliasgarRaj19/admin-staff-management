import argon2 from "argon2";

export const ARGON2_TYPE = argon2.argon2id;

export async function hashPassword(password) {
  return argon2.hash(String(password), { type: ARGON2_TYPE });
}

export async function verifyPassword(hash, password) {
  return argon2.verify(hash, String(password), { type: ARGON2_TYPE });
}
