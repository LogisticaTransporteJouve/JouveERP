import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The browser draws native date, month and week inputs in its own language
// («November 2026», «Clear», «This month») and with its own look. Dates go
// through DatePicker and months through MonthPicker, both in Spanish.
const NEEDLE = /type=["'{]\s*["'`]?(date|month|week)["'`]?/;

const ROOT = path.resolve(import.meta.dirname, "..");
const SCANNED = ["app", "components", "features"];
const PICKERS = new Set([
  "components/ui/date-picker.tsx",
  "components/ui/month-picker.tsx",
]);

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

describe("date inputs", () => {
  it("never render a native date, month or week input", () => {
    const offenders = SCANNED.flatMap(sources).filter(
      (f) =>
        !PICKERS.has(f) &&
        NEEDLE.test(readFileSync(path.join(ROOT, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("matches the forms a native input takes", () => {
    for (const snippet of ['type="date"', "type='month'", 'type={"week"}']) {
      expect(NEEDLE.test(snippet)).toBe(true);
    }
    expect(NEEDLE.test('type="button"')).toBe(false);
  });
});
