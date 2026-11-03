import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// HR money fields read es-AR amounts with parseArAmount ("150.000" is
// 150000). Swapping the comma for a dot reads "150.000" as 150, so it stays
// only on the non-money fields counted here.
const NON_MONEY = new Map([
  ["salary-raise-dialog.tsx", 2], // percentage
  ["employee-garnishments-card.tsx", 1], // percentage mode
  ["final-settlement-card.tsx", 1], // vacation days
]);
const COMMA_TO_DOT = 'replace(/,/g, ".")';

describe("HR money inputs", () => {
  it("never parse an amount by swapping the comma for a dot", () => {
    const dir = import.meta.dirname;
    const offenders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".tsx") || file.endsWith(".test.tsx")) continue;
      const text = readFileSync(path.join(dir, file), "utf8");
      const hits = text.split(COMMA_TO_DOT).length - 1;
      if (hits > (NON_MONEY.get(file) ?? 0)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
