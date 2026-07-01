import { APICallError } from "ai";
import { describe, expect, it, vi } from "vitest";

import { isRetryableModelError, runWithFallback } from "./model";

function apiError(statusCode: number): APICallError {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: "https://api.test/v1/messages",
    requestBodyValues: {},
    statusCode,
  });
}

describe("isRetryableModelError", () => {
  it("treats 5xx and 429 as retryable", () => {
    expect(isRetryableModelError(apiError(503))).toBe(true);
    expect(isRetryableModelError(apiError(429))).toBe(true);
  });

  it("treats other 4xx as non-retryable", () => {
    expect(isRetryableModelError(apiError(400))).toBe(false);
    expect(isRetryableModelError(apiError(401))).toBe(false);
  });

  it("treats non-API errors as non-retryable", () => {
    expect(isRetryableModelError(new Error("boom"))).toBe(false);
    expect(isRetryableModelError("nope")).toBe(false);
  });
});

describe("runWithFallback", () => {
  it("returns the first success without calling later attempts", async () => {
    const second = vi.fn(async () => "b");
    const result = await runWithFallback([async () => "a", second]);
    expect(result).toBe("a");
    expect(second).not.toHaveBeenCalled();
  });

  it("rotates to the next attempt on a retryable error and reports it", async () => {
    const onFallback = vi.fn();
    const result = await runWithFallback(
      [
        async () => {
          throw apiError(503);
        },
        async () => "recovered",
      ],
      { onFallback },
    );
    expect(result).toBe("recovered");
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(0, expect.any(APICallError));
  });

  it("propagates a non-retryable error without trying the next attempt", async () => {
    const second = vi.fn(async () => "b");
    await expect(
      runWithFallback([
        async () => {
          throw apiError(400);
        },
        second,
      ]),
    ).rejects.toBeInstanceOf(APICallError);
    expect(second).not.toHaveBeenCalled();
  });

  it("propagates the last error when every attempt fails", async () => {
    await expect(
      runWithFallback([
        async () => {
          throw apiError(503);
        },
        async () => {
          throw apiError(500);
        },
      ]),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it("honors an injected isRetryable predicate", async () => {
    const result = await runWithFallback(
      [
        async () => {
          throw new Error("transient");
        },
        async () => "ok",
      ],
      { isRetryable: () => true },
    );
    expect(result).toBe("ok");
  });
});
