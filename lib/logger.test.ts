import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __test__, logger } from "@/lib/logger";

const { redact, isSensitiveKey } = __test__;

type LogLine = {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  [k: string]: unknown;
};

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((line: string) => {
    out.push(line);
  });
  const errSpy = vi
    .spyOn(console, "error")
    .mockImplementation((line: string) => {
      err.push(line);
    });
  return {
    out,
    err,
    restore: () => {
      logSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

function parse(line: string | undefined): LogLine {
  if (!line) throw new Error("expected log line, got undefined");
  return JSON.parse(line) as LogLine;
}

describe("isSensitiveKey", () => {
  it("matches sensitive fragments case-insensitively", () => {
    expect(isSensitiveKey("password")).toBe(true);
    expect(isSensitiveKey("Authorization")).toBe(true);
    expect(isSensitiveKey("Set-Cookie")).toBe(true);
    expect(isSensitiveKey("apiKey")).toBe(true);
    expect(isSensitiveKey("api_key")).toBe(true);
    expect(isSensitiveKey("private_key")).toBe(true);
    expect(isSensitiveKey("user_token")).toBe(true);
    expect(isSensitiveKey("certificate")).toBe(true);
    expect(isSensitiveKey("clientSignature")).toBe(true);
  });

  it("leaves benign keys alone", () => {
    expect(isSensitiveKey("userId")).toBe(false);
    expect(isSensitiveKey("name")).toBe(false);
    expect(isSensitiveKey("createdAt")).toBe(false);
  });
});

describe("redact", () => {
  it("redacts top-level sensitive values", () => {
    const result = redact({
      userId: "u1",
      password: "hunter2",
      authorization: "Bearer abc",
    });
    expect(result).toEqual({
      userId: "u1",
      password: "[REDACTED]",
      authorization: "[REDACTED]",
    });
  });

  it("redacts nested values recursively", () => {
    const result = redact({
      user: { name: "Tom", token: "xyz" },
      headers: { "Set-Cookie": "session=1", "Content-Type": "json" },
    });
    expect(result).toEqual({
      user: { name: "Tom", token: "[REDACTED]" },
      headers: { "Set-Cookie": "[REDACTED]", "Content-Type": "json" },
    });
  });

  it("redacts inside arrays", () => {
    const result = redact({
      items: [
        { id: 1, password: "a" },
        { id: 2, password: "b" },
      ],
    });
    expect(result).toEqual({
      items: [
        { id: 1, password: "[REDACTED]" },
        { id: 2, password: "[REDACTED]" },
      ],
    });
  });

  it("does not mutate the input", () => {
    const input = { password: "hunter2", nested: { token: "xyz" } };
    const snapshot = JSON.parse(JSON.stringify(input)) as typeof input;
    redact(input);
    expect(input).toEqual(snapshot);
  });

  it("handles circular references", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
  });

  it("serializes Error instances with name, message, and stack", () => {
    const err = new Error("boom");
    const result = redact({ error: err }) as { error: { message: string } };
    expect(result.error.message).toBe("boom");
    expect(result.error).toHaveProperty("stack");
    expect(result.error).toHaveProperty("name", "Error");
  });
});

describe("logger output", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("emits structured JSON with timestamp + level + message", () => {
    const { out, restore } = captureConsole();
    logger.info("hello", { userId: "u1" });
    restore();
    const line = parse(out[0]);
    expect(line.level).toBe("info");
    expect(line.message).toBe("hello");
    expect(line.userId).toBe("u1");
    expect(typeof line.timestamp).toBe("string");
    expect(new Date(line.timestamp).toISOString()).toBe(line.timestamp);
  });

  it("redacts sensitive context keys before stdout", () => {
    const { out, restore } = captureConsole();
    logger.info("op", { token: "secretvalue", id: 1 });
    restore();
    const line = parse(out[0]);
    expect(line.token).toBe("[REDACTED]");
    expect(line.id).toBe(1);
    expect(out[0]).not.toContain("secretvalue");
  });

  it("routes warn and error to stderr, info/debug to stdout", () => {
    const { out, err, restore } = captureConsole();
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    restore();
    expect(out).toHaveLength(1);
    expect(err).toHaveLength(2);
  });

  it("suppresses debug in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEBUG", "");
    vi.stubEnv("LOG_LEVEL", "");
    const { out, err, restore } = captureConsole();
    logger.debug("noisy");
    logger.info("kept");
    restore();
    expect(out).toHaveLength(1);
    expect(err).toHaveLength(0);
    expect(parse(out[0]).message).toBe("kept");
  });

  it("respects explicit LOG_LEVEL=warn", () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    const { out, err, restore } = captureConsole();
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    restore();
    expect(out).toHaveLength(0);
    expect(err).toHaveLength(2);
  });

  it("includes Error message in nested error context", () => {
    const { err, restore } = captureConsole();
    logger.error("op failed", { error: new Error("boom") });
    restore();
    const line = parse(err[0]);
    const error = line.error as { message: string; stack: string };
    expect(error.message).toBe("boom");
    expect(error.stack).toContain("boom");
  });
});
