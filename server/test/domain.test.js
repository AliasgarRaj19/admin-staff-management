import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalPermissions, permissionGroups } from "../src/domain/permissions.js";
import { canonicalPermissionSeeds } from "../src/domain/permissionSeeds.js";
import { DEFAULT_ROLE_NAME, MAX_ROLE_NAME_LENGTH, normalizeRoleName, STAFF_ACCOUNT_STATUS } from "../src/domain/staff.js";

const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);

function readSchema() {
  return readFileSync(schemaPath, "utf8");
}

test("blank role input resolves to Moderator", () => {
  assert.equal(normalizeRoleName(""), DEFAULT_ROLE_NAME);
  assert.equal(normalizeRoleName("   "), DEFAULT_ROLE_NAME);
  assert.equal(normalizeRoleName(null), DEFAULT_ROLE_NAME);
  assert.equal(normalizeRoleName("Content Manager"), "Content Manager");
});

test("custom roleName is trimmed, preserved, and bounded", () => {
  assert.equal(normalizeRoleName("  Sales Manager  "), "Sales Manager");
  assert.throws(() => normalizeRoleName("x".repeat(MAX_ROLE_NAME_LENGTH + 1)), /characters or fewer/);
});

test("staff statuses remain canonical", () => {
  assert.deepEqual(Object.values(STAFF_ACCOUNT_STATUS), ["invited", "active", "blocked", "removed"]);
});

test("permission keys remain unique", () => {
  assert.equal(new Set(canonicalPermissions).size, canonicalPermissions.length);
  assert.equal(canonicalPermissionSeeds.length, canonicalPermissions.length);
  assert.deepEqual(new Set(canonicalPermissionSeeds.map((permission) => permission.key)).size, canonicalPermissionSeeds.length);
  assert.ok(permissionGroups.staff.includes("staff.permanent_delete"));
});

test("schema keeps MasterAdmin isolated and audit logs retained", () => {
  const schema = readSchema();
  assert.match(schema, /model MasterAdmin/);
  assert.match(schema, /model StaffAccount/);
  assert.match(schema, /model MasterAdminRefreshToken/);
  assert.match(schema, /model StaffRefreshToken/);
  const staffAccountBlock = schema.match(/model StaffAccount\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(staffAccountBlock, /masterAdminId/i);
  assert.doesNotMatch(staffAccountBlock, /MasterAdminRefreshToken/);
  assert.match(schema, /roleName\s+String\s+@default\("Moderator"\)/);
  assert.doesNotMatch(staffAccountBlock, /roleName\s+String[^]*@unique/);
  assert.match(schema, /model Role/);
  assert.match(schema, /model StaffRole/);
  assert.match(schema, /model RolePermission/);
  assert.match(schema, /model StaffPermission/);
  assert.match(schema, /actorStaffAccountId\s+String\?[^]*onDelete: SetNull/);
});

test("roleName is a designation, not a permission bundle", () => {
  assert.ok(permissionGroups.staff.includes("staff.manage"));
  assert.ok(permissionGroups.permissions.includes("permissions.manage"));
  assert.ok(permissionGroups.audit.includes("audit_logs.read"));
  assert.equal(permissionGroups.moderator, undefined);
});
