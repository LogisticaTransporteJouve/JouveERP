import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimitError, enforceRateLimit } from "./rate-limit";

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc: rpcMock }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const args = {
  userId: "11111111-1111-4111-8111-111111111111",
  key: "padron_lookup",
  max: 60,
  windowMs: 60 * 60 * 1000,
};

beforeEach(() => {
  rpcMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("enforceRateLimit", () => {
  it("allows when count is under the limit", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    await expect(enforceRateLimit(args)).resolves.toBeUndefined();
    expect(rpcMock).toHaveBeenCalledWith(
      "bump_rate_limit_bucket",
      expect.objectContaining({
        p_user_id: args.userId,
        p_bucket_key: args.key,
      }),
    );
  });

  it("allows when count equals the limit", async () => {
    rpcMock.mockResolvedValue({ data: args.max, error: null });
    await expect(enforceRateLimit(args)).resolves.toBeUndefined();
  });

  it("denies when count exceeds the limit", async () => {
    rpcMock.mockResolvedValue({ data: args.max + 1, error: null });
    await expect(enforceRateLimit(args)).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it("returns a positive retryAfterSeconds inside the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T12:30:00.000Z"));
    rpcMock.mockResolvedValue({ data: args.max + 5, error: null });

    try {
      await enforceRateLimit(args);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      const e = err as RateLimitError;
      // Window started at 12:00, ends at 13:00 → ~1800s remaining at 12:30.
      expect(e.retryAfterSeconds).toBeGreaterThan(0);
      expect(e.retryAfterSeconds).toBeLessThanOrEqual(args.windowMs / 1000);
    }
  });

  it("fails closed when the RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(enforceRateLimit(args)).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it("aligns window_start to the windowMs grid", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T12:34:56.789Z"));
    rpcMock.mockResolvedValue({ data: 1, error: null });

    await enforceRateLimit(args);
    const callArgs = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(callArgs.p_window_start).toBe("2026-05-08T12:00:00.000Z");
  });
});
