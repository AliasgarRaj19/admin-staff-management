import { normalizeAuthResponse } from "./session.js";

const REFRESH_RETRY_DELAY_MS = 250;
const REFRESH_RETRY_LIMIT = 2;

export async function refreshWithRetry(role, refreshFn) {
  let lastError = null;
  for (let attempt = 0; attempt < REFRESH_RETRY_LIMIT; attempt += 1) {
    try {
      const response = await refreshFn(role);
      return normalizeAuthResponse(role, response);
    } catch (error) {
      lastError = error;
      if (error?.status === 409 && error?.payload?.message === "REFRESH_RETRY" && attempt < REFRESH_RETRY_LIMIT - 1) {
        await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAY_MS));
        continue;
      }
      break;
    }
  }
  if (lastError?.status === 409 && lastError?.payload?.message === "REFRESH_RETRY") {
    return null;
  }
  return null;
}

export { REFRESH_RETRY_DELAY_MS, REFRESH_RETRY_LIMIT };
