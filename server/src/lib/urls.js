function normalizeBasePath(basePath = "") {
  const trimmed = String(basePath ?? "").trim();
  if (!trimmed) return "";
  const withoutTrailing = trimmed.replace(/\/+$/, "");
  if (!withoutTrailing) return "";
  return withoutTrailing.startsWith("/") ? withoutTrailing : `/${withoutTrailing}`;
}

function normalizeOrigin(origin = "") {
  return String(origin ?? "").trim().replace(/\/+$/, "");
}

export function buildClientUrlPath(clientUrl, appBasePath, path) {
  const origin = normalizeOrigin(clientUrl);
  if (!origin) throw new Error("CLIENT_URL is required.");

  const basePath = normalizeBasePath(appBasePath);
  const routePath = String(path ?? "").startsWith("/") ? String(path ?? "") : `/${String(path ?? "")}`;
  return `${origin}${basePath}${routePath}`;
}
