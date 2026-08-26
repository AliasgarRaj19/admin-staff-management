import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildApiBaseUrl, getApiBaseUrl, getRouterBasename } from "../src/appConfig.js";

describe("appConfig", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "");
    vi.stubEnv("VITE_APP_BASE_PATH", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("local api url resolves to the backend origin without duplicating /api", () => {
    expect(buildApiBaseUrl("", "http://localhost:5500/api")).toBe("http://localhost:5500");
    expect(`${buildApiBaseUrl("", "http://localhost:5500")}/api/auth/login`).toBe("http://localhost:5500/api/auth/login");
  });

  test("production api url and router basename resolve to the deployment base path", () => {
    vi.stubEnv("VITE_API_URL", "/jwt-auth-demo/api");
    vi.stubEnv("VITE_APP_BASE_PATH", "/jwt-auth-demo");
    expect(getApiBaseUrl()).toBe("/jwt-auth-demo");
    expect(`${getApiBaseUrl()}/api/auth/login`).toBe("/jwt-auth-demo/api/auth/login");
    expect(getRouterBasename()).toBe("/jwt-auth-demo");
  });
});
