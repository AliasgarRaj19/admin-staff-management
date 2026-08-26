import test from "node:test";
import assert from "node:assert/strict";
import { buildClientUrlPath } from "../src/lib/urls.js";

test("client url path combines origin, base path, and route without duplicate slashes", () => {
  assert.equal(
    buildClientUrlPath("https://signalgrowth.in/", "/admin-staff/", "/staff/register?token=raw-token"),
    "https://signalgrowth.in/admin-staff/staff/register?token=raw-token",
  );
  assert.equal(
    buildClientUrlPath("https://signalgrowth.in", "admin-staff", "staff/register?token=raw-token"),
    "https://signalgrowth.in/admin-staff/staff/register?token=raw-token",
  );
});

test("client url path omits base path when it is empty", () => {
  assert.equal(
    buildClientUrlPath("https://signalgrowth.in/", "", "/staff/register?token=raw-token"),
    "https://signalgrowth.in/staff/register?token=raw-token",
  );
});

