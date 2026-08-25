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
]) {
  test(`required file exists: ${relativePath}`, () => {
    assert.equal(existsSync(new URL(relativePath, root)), true);
  });
}
