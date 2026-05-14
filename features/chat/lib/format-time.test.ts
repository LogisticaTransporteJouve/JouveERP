import { describe, expect, it } from "vitest";

import {
  formatMessageDay,
  formatMessageTime,
  formatRelativeShort,
  isSameDay,
  withinMinutes,
} from "./format-time";

describe("formatRelativeShort", () => {
  const NOW = new Date("2026-05-14T12:00:00Z");

  it("returns empty string for null", () => {
    expect(formatRelativeShort(null, NOW)).toBe("");
  });

  it("returns 'ahora' for very recent", () => {
    const iso = new Date(NOW.getTime() - 10_000).toISOString();
    expect(formatRelativeShort(iso, NOW)).toBe("ahora");
  });

  it("returns Xm under an hour", () => {
    const iso = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    expect(formatRelativeShort(iso, NOW)).toBe("5m");
  });

  it("returns Xh under a day", () => {
    const iso = new Date(NOW.getTime() - 3 * 3_600_000).toISOString();
    expect(formatRelativeShort(iso, NOW)).toBe("3h");
  });

  it("returns Xd under a week", () => {
    const iso = new Date(NOW.getTime() - 3 * 86_400_000).toISOString();
    expect(formatRelativeShort(iso, NOW)).toBe("3d");
  });

  it("returns date for older", () => {
    const iso = new Date("2026-04-01T12:00:00Z").toISOString();
    const result = formatRelativeShort(iso, NOW);
    expect(result).toMatch(/^\d{2}\/\d{2}$/);
  });
});

describe("isSameDay", () => {
  it("returns true for same calendar day (local)", () => {
    // 12:00 y 18:00 del mismo día son el mismo día en cualquier zona
    // horaria razonable (no salta de día entre esos puntos).
    expect(
      isSameDay("2026-05-14T12:00:00Z", "2026-05-14T18:00:00Z"),
    ).toBe(true);
  });

  it("returns false for clearly different days", () => {
    // 48h de diferencia: distinto día en cualquier TZ.
    expect(
      isSameDay("2026-05-14T12:00:00Z", "2026-05-16T12:00:00Z"),
    ).toBe(false);
  });
});

describe("withinMinutes", () => {
  it("returns true within the threshold", () => {
    expect(
      withinMinutes("2026-05-14T12:00:00Z", "2026-05-14T12:04:00Z", 5),
    ).toBe(true);
  });

  it("returns false past the threshold", () => {
    expect(
      withinMinutes("2026-05-14T12:00:00Z", "2026-05-14T12:06:00Z", 5),
    ).toBe(false);
  });
});

describe("formatMessageTime", () => {
  it("returns HH:MM", () => {
    const iso = "2026-05-14T12:34:00Z";
    const result = formatMessageTime(iso);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("formatMessageDay", () => {
  it("returns a non-empty localized string", () => {
    const result = formatMessageDay("2026-05-14T12:00:00Z");
    expect(result.length).toBeGreaterThan(0);
  });
});
