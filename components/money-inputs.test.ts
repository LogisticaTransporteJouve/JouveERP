import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every amount field renders MoneyInput, which formats es-AR while typing, and
// the form reads it with parseArAmount. A raw decimal input reads "15.000" as
// 15 and "1.500,50" as nothing; a comma-for-dot swap reads "1.500,50" as 1.5.
// Those patterns stay only on the non-money fields counted here, by file.
const ALLOWED = new Map<string, { count: number; why: string }>([
  [
    "features/ai/document/components/create-payment-doc-dialog.tsx",
    { count: 1, why: "voucher number" },
  ],
  [
    "features/hr/components/attendance-cell-dialog.tsx",
    { count: 1, why: "hours" },
  ],
  [
    "features/hr/components/employee-garnishments-card.tsx",
    { count: 2, why: "percentage mode" },
  ],
  [
    "features/hr/components/final-settlement-card.tsx",
    { count: 2, why: "vacation days" },
  ],
  [
    "features/hr/components/salary-raise-dialog.tsx",
    { count: 3, why: "percentage" },
  ],
  [
    "features/inflation/components/inflation-page.tsx",
    { count: 1, why: "coefficient" },
  ],
  [
    "features/late-interest/components/issue-late-interest-dialog.tsx",
    { count: 2, why: "monthly rate (%)" },
  ],
  [
    "features/late-interest/components/late-interest-rate-dialog.tsx",
    { count: 2, why: "monthly rate (%)" },
  ],
  [
    "features/loans/components/loan-dialog.tsx",
    { count: 1, why: "installments count" },
  ],
  [
    "features/pallets/components/bulk-pallet-dialog.tsx",
    { count: 3, why: "units per pallet and pallet count" },
  ],
  ["features/pallets/components/pallet-dialog.tsx", { count: 2, why: "units" }],
  [
    "features/payment-orders/components/payment-order-form.tsx",
    { count: 1, why: "voucher number" },
  ],
  [
    "features/purchase-invoices/components/purchase-invoice-form.tsx",
    { count: 2, why: "point of sale and voucher number" },
  ],
  [
    "features/receipts/components/receipt-form.tsx",
    { count: 1, why: "voucher number" },
  ],
  [
    "features/storage-tariffs/components/increase-tariffs-dialog.tsx",
    { count: 2, why: "percentage" },
  ],
  [
    "features/suppliers/components/supplier-form.tsx",
    { count: 1, why: "payment term days" },
  ],
  [
    "features/tasks/components/task-form-dialog.tsx",
    { count: 1, why: "day of month" },
  ],
  [
    "features/vehicles/components/vehicle-dialog.tsx",
    { count: 2, why: "year and capacity kg" },
  ],
  [
    "features/warehouses/components/warehouse-dialog.tsx",
    { count: 1, why: "pallet capacity" },
  ],
]);

const NEEDLES = [
  'type="number"',
  'inputMode="decimal"',
  'replace(",", ".")',
  'replace(/,/g, ".")',
];

const ROOT = path.resolve(import.meta.dirname, "..");
const SCANNED = ["app", "components", "features"];
// MoneyInput itself sets inputMode="decimal".
const SKIPPED = new Set(["components/money-input.tsx"]);

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

function hits(file: string): number {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  return NEEDLES.reduce((n, needle) => n + text.split(needle).length - 1, 0);
}

describe("money inputs", () => {
  const files = SCANNED.flatMap(sources).filter((f) => !SKIPPED.has(f));

  it("render amounts through MoneyInput, never a raw decimal input", () => {
    const offenders = files.filter(
      (f) => hits(f) > (ALLOWED.get(f)?.count ?? 0),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist exact, so a fixed field leaves it", () => {
    const stale = [...ALLOWED].filter(([f, { count }]) => hits(f) !== count);
    expect(stale.map(([f]) => f)).toEqual([]);
  });
});
