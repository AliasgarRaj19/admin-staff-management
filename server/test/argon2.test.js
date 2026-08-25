import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, ARGON2_TYPE } from "../src/lib/password.js";

test("argon2 hashes and verifies passwords", async () => {
  const hash = await hashPassword("StrongPass123");
  assert.notEqual(hash, "StrongPass123");
  assert.equal(await verifyPassword(hash, "StrongPass123"), true);
  assert.equal(await verifyPassword(hash, "WrongPass123"), false);
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(ARGON2_TYPE, 2);
});
