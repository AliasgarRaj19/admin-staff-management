import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const requiredFiles = [
  "prisma/schema.prisma",
  "prisma/migrations/20260825000000_initial/migration.sql",
  "src/domain/staff.js",
  "src/domain/permissions.js",
  "src/domain/audit.js",
];

const missing = requiredFiles.filter((relativePath) => !existsSync(join(root, relativePath)));
if (missing.length > 0) {
  console.error(`Missing required phase 1 files: ${missing.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("Phase 1 build check passed.");
}
