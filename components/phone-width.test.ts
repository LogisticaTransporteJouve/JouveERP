import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// On a phone, a grid that only sets its columns from a breakpoint up
// (`md:grid-cols-2`) has a single `auto` column below it, and that column
// grows to its widest child (a row of nowrap text, a chart, a table): the
// whole page then scrolls sideways. `grid-cols-1` (minmax(0, 1fr)) keeps the
// column to the screen width. This scan finds the grids that skip it.

const ROOT = path.resolve(import.meta.dirname, "..");
const SCANNED = ["app", "components", "features"];

function sources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) return sources(rel);
      return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
        ? [rel]
        : [];
    },
  );
}

/** Class lists written as a plain `className="…"`. */
function classLists(text: string): string[] {
  return [...text.matchAll(/className="([^"]*)"/g)].map((m) => m[1] ?? "");
}

function responsiveGridWithoutBase(classes: string): boolean {
  const tokens = classes.split(/\s+/);
  return (
    tokens.includes("grid") &&
    tokens.some((t) => /^(sm|md|lg|xl|2xl):grid-cols-/.test(t)) &&
    !tokens.some((t) => t.startsWith("grid-cols-"))
  );
}

describe("phone width", () => {
  it("sets a base column on every grid that sets columns at a breakpoint", () => {
    const offenders = SCANNED.flatMap(sources).flatMap((file) =>
      classLists(readFileSync(path.join(ROOT, file), "utf8"))
        .filter(responsiveGridWithoutBase)
        .map((classes) => `${file}: "${classes}"`),
    );
    expect(offenders).toEqual([]);
  });

  it("detects a breakpoint-only grid", () => {
    expect(responsiveGridWithoutBase("grid gap-4 md:grid-cols-2")).toBe(true);
    expect(
      responsiveGridWithoutBase("grid grid-cols-1 gap-4 md:grid-cols-2"),
    ).toBe(false);
  });
});
