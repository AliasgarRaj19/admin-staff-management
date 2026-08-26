import { describe, expect, test, vi } from "vitest";
import { refreshWithRetry, REFRESH_RETRY_LIMIT, REFRESH_RETRY_DELAY_MS } from "../src/refreshSession.js";

describe("refreshWithRetry", () => {
  test("retries a bounded number of times on REFRESH_RETRY and then succeeds", async () => {
    vi.useFakeTimers();
    const refreshFn = vi.fn()
      .mockRejectedValueOnce({ status: 409, payload: { message: "REFRESH_RETRY" } })
      .mockResolvedValueOnce({ accessToken: "access-token", csrfToken: "csrf-token", user: { id: "staff-1" } });

    const promise = refreshWithRetry("staff", refreshFn);
    await vi.advanceTimersByTimeAsync(REFRESH_RETRY_DELAY_MS);
    const result = await promise;

    expect(result.accessToken).toBe("access-token");
    expect(refreshFn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  test("returns null after the retry limit is exhausted", async () => {
    vi.useFakeTimers();
    const refreshFn = vi.fn().mockRejectedValue({ status: 409, payload: { message: "REFRESH_RETRY" } });

    const promise = refreshWithRetry("staff", refreshFn);
    for (let index = 0; index < REFRESH_RETRY_LIMIT - 1; index += 1) {
      await vi.advanceTimersByTimeAsync(REFRESH_RETRY_DELAY_MS);
    }
    const result = await promise;

    expect(result).toBeNull();
    expect(refreshFn).toHaveBeenCalledTimes(REFRESH_RETRY_LIMIT);
    vi.useRealTimers();
  });
});
