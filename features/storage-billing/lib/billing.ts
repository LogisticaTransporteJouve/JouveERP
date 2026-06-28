// Pure storage-billing computation (no DB). 3PL model: each pallet is charged
// for the days it was stored within the billing period × the tariff's per-pallet
// rate (monthly rates prorated /30), PLUS a one-off carga (handling_in) when the
// pallet enters within the period and a one-off descarga (handling_out) when it
// leaves within the period. The client-specific tariff wins over the general
// (client_id = null) one. docs/roadmap.md Fase H.3.

const DAY_MS = 24 * 60 * 60 * 1000;

export type PalletInput = {
  id: string;
  client_id: string;
  code: string;
  entry_date: string;
  exit_date: string | null;
};

export type TariffInput = {
  client_id: string | null;
  rate_per_pallet: number;
  period: string; // 'daily' | 'monthly'
  handling_in: number;
  handling_out: number;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
};

export type BillingLine = {
  pallet_id: string;
  code: string;
  client_id: string;
  client_name: string;
  days: number;
  daily_rate: number;
  storage_charge: number;
  handling_in_charge: number;
  handling_out_charge: number;
  charge: number;
  has_tariff: boolean;
};

export type ClientBilling = {
  client_id: string;
  client_name: string;
  pallets: number;
  charge: number;
};

export type StorageBilling = {
  lines: BillingLine[];
  byClient: ClientBilling[];
  storage_total: number;
  handling_total: number;
  total: number;
  pallets_without_tariff: number;
};

function dayNum(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Inclusive days the pallet was stored within [periodStart, periodEnd]. */
function daysInPeriod(
  pallet: PalletInput,
  periodStart: number,
  periodEnd: number,
): number {
  const entry = dayNum(pallet.entry_date);
  const exit = pallet.exit_date ? dayNum(pallet.exit_date) : periodEnd;
  const start = Math.max(entry, periodStart);
  const end = Math.min(exit, periodEnd);
  return end >= start ? end - start + 1 : 0;
}

/** Picks the applicable tariff (client-specific wins; latest valid_from). */
function pickTariff(
  tariffs: TariffInput[],
  clientId: string,
  periodStart: number,
  periodEnd: number,
): TariffInput | null {
  const applicable = tariffs.filter(
    (t) =>
      t.is_active &&
      (t.client_id === clientId || t.client_id === null) &&
      dayNum(t.valid_from) <= periodEnd &&
      (t.valid_to === null || dayNum(t.valid_to) >= periodStart),
  );
  if (applicable.length === 0) return null;
  applicable.sort((a, b) => {
    // Client-specific first, then latest valid_from.
    const aSpecific = a.client_id === clientId ? 1 : 0;
    const bSpecific = b.client_id === clientId ? 1 : 0;
    if (aSpecific !== bSpecific) return bSpecific - aSpecific;
    return dayNum(b.valid_from) - dayNum(a.valid_from);
  });
  return applicable[0] ?? null;
}

export function computeStorageBilling(input: {
  pallets: PalletInput[];
  tariffs: TariffInput[];
  clientNames: Map<string, string>;
  periodStart: string;
  periodEnd: string;
}): StorageBilling {
  const pStart = dayNum(input.periodStart);
  const pEnd = dayNum(input.periodEnd);

  const lines: BillingLine[] = [];
  let withoutTariff = 0;

  for (const pallet of input.pallets) {
    const days = daysInPeriod(pallet, pStart, pEnd);
    if (days === 0) continue;
    const tariff = pickTariff(input.tariffs, pallet.client_id, pStart, pEnd);
    const dailyRate = tariff
      ? tariff.period === "monthly"
        ? tariff.rate_per_pallet / 30
        : tariff.rate_per_pallet
      : 0;
    if (!tariff) withoutTariff += 1;

    const entry = dayNum(pallet.entry_date);
    const exit = pallet.exit_date ? dayNum(pallet.exit_date) : null;
    const enteredInPeriod = entry >= pStart && entry <= pEnd;
    const exitedInPeriod = exit !== null && exit >= pStart && exit <= pEnd;

    const storageCharge = round2(days * dailyRate);
    const handlingIn = tariff && enteredInPeriod ? tariff.handling_in : 0;
    const handlingOut = tariff && exitedInPeriod ? tariff.handling_out : 0;

    lines.push({
      pallet_id: pallet.id,
      code: pallet.code,
      client_id: pallet.client_id,
      client_name: input.clientNames.get(pallet.client_id) ?? "—",
      days,
      daily_rate: round2(dailyRate),
      storage_charge: storageCharge,
      handling_in_charge: round2(handlingIn),
      handling_out_charge: round2(handlingOut),
      charge: round2(storageCharge + handlingIn + handlingOut),
      has_tariff: tariff !== null,
    });
  }

  const byClientMap = new Map<string, ClientBilling>();
  for (const line of lines) {
    const existing = byClientMap.get(line.client_id);
    if (existing) {
      existing.pallets += 1;
      existing.charge = round2(existing.charge + line.charge);
    } else {
      byClientMap.set(line.client_id, {
        client_id: line.client_id,
        client_name: line.client_name,
        pallets: 1,
        charge: line.charge,
      });
    }
  }

  const byClient = [...byClientMap.values()].sort((a, b) => b.charge - a.charge);
  const storage_total = round2(lines.reduce((s, l) => s + l.storage_charge, 0));
  const handling_total = round2(
    lines.reduce((s, l) => s + l.handling_in_charge + l.handling_out_charge, 0),
  );
  const total = round2(storage_total + handling_total);

  return {
    lines,
    byClient,
    storage_total,
    handling_total,
    total,
    pallets_without_tariff: withoutTariff,
  };
}
