const DEFAULT_API_URL = "http://localhost:5500";

function stripTrailingSlash(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function readEnv(name) {
  if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env[name] !== undefined) {
    return import.meta.env[name];
  }
  if (typeof process !== "undefined" && process.env && process.env[name] !== undefined) {
    return process.env[name];
  }
  return undefined;
}

export function buildApiBaseUrl(basePath, configuredApiUrl) {
  const raw = stripTrailingSlash(configuredApiUrl || DEFAULT_API_URL);
  const normalizedBasePath = String(basePath || "").trim();
  const candidate = raw.endsWith("/api") ? raw.slice(0, -4) : raw;
  if (!normalizedBasePath || candidate.startsWith("http")) return candidate;
  return candidate.endsWith(normalizedBasePath) ? candidate : `${candidate}${normalizedBasePath.startsWith("/") ? normalizedBasePath : `/${normalizedBasePath}`}`;
}

export function getApiBaseUrl() {
  const basePath = readEnv("VITE_APP_BASE_PATH") || "";
  const configuredApiUrl = readEnv("VITE_API_URL") || DEFAULT_API_URL;
  return buildApiBaseUrl(basePath, configuredApiUrl);
}

export function getRouterBasename() {
  const basePath = readEnv("VITE_APP_BASE_PATH") || "";
  const trimmed = String(basePath).trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function getStaffAppBasePath() {
  return getRouterBasename();
}
