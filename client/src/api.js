import { getApiBaseUrl } from "./appConfig.js";

const API_BASE = getApiBaseUrl();

export async function request(path, { method = "GET", body, csrfToken, headers = {} } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...headers,
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || response.statusText || "Request failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function requestJson(path, options) {
  return request(path, options);
}
