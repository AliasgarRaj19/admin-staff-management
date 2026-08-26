import { describe, expect, test, vi } from "vitest";
import { resetSessionRestoreForTests, restoreSessionOnce } from "../src/sessionRestore.js";

describe("sessionRestore", () => {
  test("concurrent restore calls share one in-flight request", async () => {
    resetSessionRestoreForTests();
    let calls = 0;
    const restoreFn = vi.fn(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { accessToken: "token" };
    });
    const [first, second] = await Promise.all([
      restoreSessionOnce("staff", restoreFn),
      restoreSessionOnce("staff", restoreFn),
    ]);
    expect(first).toEqual({ accessToken: "token" });
    expect(second).toEqual({ accessToken: "token" });
    expect(calls).toBe(1);
  });

  test("failed restore returns null", async () => {
    resetSessionRestoreForTests();
    const result = await restoreSessionOnce("masterAdmin", async () => {
      throw new Error("no cookie");
    });
    expect(result).toBeNull();
  });
});
