import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

test("role and permission join models are composite-keyed", () => {
  assert.match(schema, /model RolePermission[\s\S]*@@id\(\[roleId, permissionId\]\)/);
  assert.match(schema, /model StaffPermission[\s\S]*@@id\(\[staffAccountId, permissionId\]\)/);
  assert.match(schema, /model StaffRole[\s\S]*@@id\(\[staffAccountId, roleId\]\)/);
});

test("refresh tokens are unique and support lineage fields", () => {
  assert.match(schema, /model StaffRefreshToken[\s\S]*tokenHash\s+String\s+@unique/);
  assert.match(schema, /model StaffRefreshToken[\s\S]*jti\s+String\s+@unique/);
  assert.match(schema, /model StaffRefreshToken[\s\S]*familyId\s+String/);
  assert.match(schema, /model StaffRefreshToken[\s\S]*replacedByTokenId\s+String\?\s+@unique/);
  assert.match(schema, /model MasterAdminRefreshToken[\s\S]*tokenHash\s+String\s+@unique/);
  assert.match(schema, /model MasterAdminRefreshToken[\s\S]*jti\s+String\s+@unique/);
});

test("invitations and password resets keep token hashes unique", () => {
  assert.match(schema, /model StaffInvitation[\s\S]*tokenHash\s+String\s+@unique/);
  assert.match(schema, /model StaffPasswordReset[\s\S]*tokenHash\s+String\s+@unique/);
});

test("audit logs survive staff deletion", () => {
  assert.match(schema, /model AuditLog[\s\S]*onDelete: SetNull/);
});
