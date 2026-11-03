import { describe, expect, it } from "vitest";

import {
  computeStorageBilling,
  type ClientTariffInput,
  type PalletInput,
  type TariffInput,
} from "./billing";

// 20261104080500 moves a client's single, open-ended storage_tariffs row to
// its tarifario with the same prices and validity, and keeps the row as the
// fallback. For every period from the row's first full month on, billing
// must not change: same lines, same totals.

const names = new Map([
  ["c1", "Acme"],
  ["c2", "Beta"],
]);

const row: TariffInput = {
  client_id: "c1",
  rate_per_pallet: 3100,
  period: "monthly",
  handling_in: 450,
  handling_out: 0,
  valid_from: "2026-03-01",
  valid_to: null,
  is_active: true,
};
const general: TariffInput = {
  ...row,
  client_id: null,
  rate_per_pallet: 2000,
  handling_in: 100,
  handling_out: 120,
  valid_from: "2025-01-01",
};

/** What the migration writes for `row` (handling_out 0 is not copied). */
const migrated: ClientTariffInput[] = [
  {
    client_id: "c1",
    concept: "storage",
    unit: "pallet_month",
    price: 3100,
    currency: "ARS",
    valid_from: "2026-03-01",
    valid_to: null,
  },
  {
    client_id: "c1",
    concept: "handling_in",
    unit: "pallet",
    price: 450,
    currency: "ARS",
    valid_from: "2026-03-01",
    valid_to: null,
  },
];

const pallets: PalletInput[] = [
  // Stored the whole month.
  {
    id: "p1",
    client_id: "c1",
    code: "A",
    entry_date: "2026-02-10",
    exit_date: null,
  },
  // In and out within the month (carga and descarga).
  {
    id: "p2",
    client_id: "c1",
    code: "B",
    entry_date: "2026-07-03",
    exit_date: "2026-07-17",
  },
  // Odd day counts to stress the /30 rounding.
  {
    id: "p3",
    client_id: "c1",
    code: "C",
    entry_date: "2026-07-07",
    exit_date: null,
  },
  {
    id: "p4",
    client_id: "c1",
    code: "D",
    entry_date: "2026-06-29",
    exit_date: "2026-07-01",
  },
  // Another client: untouched either way.
  {
    id: "p5",
    client_id: "c2",
    code: "E",
    entry_date: "2026-07-05",
    exit_date: null,
  },
];

function bill(
  clientTariffs: ClientTariffInput[],
  periodStart: string,
  periodEnd: string,
) {
  const r = computeStorageBilling({
    pallets,
    tariffs: [row, general],
    clientTariffs,
    usdRate: null,
    clientNames: names,
    periodStart,
    periodEnd,
  });
  // The snapshot names the tariff rows used (now the tarifario's); the
  // figures are what must not move.
  return { ...r, applied_tariffs: [] };
}

describe("storage tariffs moved to the client's tarifario", () => {
  it.each([
    ["2026-03-01", "2026-03-31"],
    ["2026-06-01", "2026-06-30"],
    ["2026-07-01", "2026-07-31"],
    ["2026-07-01", "2026-07-15"],
    ["2027-02-01", "2027-02-28"],
  ])("bills %s to %s exactly as before", (from, to) => {
    expect(bill(migrated, from, to)).toEqual(bill([], from, to));
  });

  it("keeps the general tariff for the other client", () => {
    const after = bill(migrated, "2026-07-01", "2026-07-31");
    const beta = after.lines.find((l) => l.client_id === "c2");
    expect(beta?.handling_in_charge).toBe(100);
  });
});
