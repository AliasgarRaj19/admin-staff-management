import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const root = new URL("..", import.meta.url);

for (const relativePath of [
  "prisma/schema.prisma",
  "prisma/migrations/20260825000000_initial/migration.sql",
  "src/domain/staff.js",
  "src/domain/permissions.js",
  "src/domain/audit.js",
  "src/config/env.js",
  "src/lib/crypto.js",
  "src/lib/jwtKeys.js",
  "src/lib/jwt.js",
  "src/lib/cookies.js",
  "src/lib/limiter.js",
  "src/lib/email.js",
  "src/lib/validators.js",
  "src/services/auth.js",
  "src/services/masterAdminBootstrap.js",
  "src/middleware/auth.js",
  "src/routes/auth.js",
  "src/routes/user.js",
  "src/routes/admin.js",
  "src/app.js",
  "src/index.js",
]) {
  test(`required file exists: ${relativePath}`, () => {
    assert.equal(existsSync(new URL(relativePath, root)), true);
  });
}
