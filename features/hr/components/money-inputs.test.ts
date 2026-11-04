import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// HR money fields read es-AR amounts with parseArAmount ("150.000" is
// 150000), so they render MoneyInput, which formats while typing: a raw
// decimal input would show "1500.50" and save 150050. The comma-for-dot swap
// and raw decimal inputs stay only on the non-money fields counted here.
const COMMA_TO_DOT_ALLOWED = new Map([
  ["salary-raise-dialog.tsx", 2], // percentage
  ["employee-garnishments-card.tsx", 1], // percentage mode
  ["final-settlement-card.tsx", 1], // vacation days
]);
const RAW_DECIMAL_ALLOWED = new Map([
  ["salary-raise-dialog.tsx", 1], // percentage
  ["employee-garnishments-card.tsx", 1], // percentage mode
  ["final-settlement-card.tsx", 1], // vacation days
  ["attendance-cell-dialog.tsx", 1], // hours
]);

function offenders(
  needle: string,
  allowed: Map<string, number>,
  banned?: string,
): string[] {
  const dir = import.meta.dirname;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .filter((f) => {
      const text = readFileSync(path.join(dir, f), "utf8");
      const hits = text.split(needle).length - 1;
      return (
        hits > (allowed.get(f) ?? 0) || (banned ? text.includes(banned) : false)
      );
    });
}

describe("HR money inputs", () => {
  it("never parse an amount by swapping the comma for a dot", () => {
    expect(offenders('replace(/,/g, ".")', COMMA_TO_DOT_ALLOWED)).toEqual([]);
  });

  it("render amounts through MoneyInput, never a raw decimal input", () => {
    expect(
      offenders('inputMode="decimal"', RAW_DECIMAL_ALLOWED, 'type="number"'),
    ).toEqual([]);
  });
});
