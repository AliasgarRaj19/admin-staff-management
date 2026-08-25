import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const prismaHelper = readFileSync(new URL("../src/lib/prisma.js", import.meta.url), "utf8");
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

test("prisma helper uses a singleton reuse pattern", () => {
  assert.match(prismaHelper, /globalThis/);
  assert.match(prismaHelper, /Pool/);
  assert.match(prismaHelper, /createApi/);
  assert.match(prismaHelper, /NODE_ENV !== "production"/);
});

test("datasource uses DATABASE_URL", () => {
  assert.doesNotMatch(schema, /url\s+=\s+env\("DATABASE_URL"\)/);
});
