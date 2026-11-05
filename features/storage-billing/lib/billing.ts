// Pure storage-billing computation (no DB). 3PL model: each pallet is charged
// for the days it was stored within the billing period × the tariff's per-pallet
// rate (monthly rates prorated /30), PLUS a one-off carga (handling_in) when the
// pallet enters within the period and a one-off descarga (handling_out) when it
// leaves within the period. docs/roadmap.md Fase H.3.
//
// Which price applies (roadmap 4.2): the client's own tariff (client_tariffs)
// in force that day — each stored day, the entry day for the carga, the exit
// day for the descarga — and, for what it does not cover, the storage tariff
// (storage_tariffs: the client-specific one wins over the general, latest
// valid_from), as before. A USD client tariff is converted at `usdRate`.
//
// Areas (roadmap 4.4): for a pallet in an area, the client's tariff for that
// area wins over the client's tariff for every area (area_id null) on the
// days and events it covers. Among storage_tariffs, the client's row wins
// over the general one of the pallet's area, which wins over the general
// one of every area (20261104080400). Full precedence: client area tariff,
// client tariff, client storage tariff, general area tariff, general.

import {
  dailyPrice,
  type ClientTariffConcept,
  type ClientTariffCurrency,
  type ClientTariffUnit,
} from "@/features/client-tariffs/schema";
import { toArs } from "@/lib/fx";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PalletInput = {
  id: string;
  client_id: string;
  code: string;
  entry_date: string;
  exit_date: string | null;
  /** Warehouse area; null or absent = none. */
  area_id?: string | null;
};

export type TariffInput = {
  client_id: string | null;
  /** A general tariff limited to one area; null or absent = every area. */
  area_id?: string | null;
  rate_per_pallet: number;
  period: string; // 'daily' | 'monthly'
  handling_in: number;
  handling_out: number;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
};

/** The storage_tariffs columns a TariffInput is built from. */
export const STORAGE_TARIFF_COLUMNS =
  "client_id, area_id, rate_per_pallet, period, handling_in, handling_out, valid_from, valid_to, is_active";

/** A storage_tariffs row as billing prices it, area included: dropping
 *  area_id would apply an area's general tariff to every area. */
export function toTariffInput(row: {
  client_id: string | null;
  area_id: string | null;
  rate_per_pallet: number;
  period: string;
  handling_in: number;
  handling_out: number;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
}): TariffInput {
  return {
    client_id: row.client_id,
    area_id: row.area_id,
    rate_per_pallet: Number(row.rate_per_pallet),
    period: row.period,
    handling_in: Number(row.handling_in),
    handling_out: Number(row.handling_out),
    valid_from: row.valid_from,
    valid_to: row.valid_to,
    is_active: row.is_active,
  };
}

/** A client_tariffs row. No two of one client and concept overlap (DB). */
export type ClientTariffInput = {
  client_id: string;
  concept: ClientTariffConcept;
  unit: ClientTariffUnit;
  price: number;
  currency: ClientTariffCurrency;
  valid_from: string;
  valid_to: string | null;
  /** The area it is limited to; null or absent = every area. */
  area_id?: string | null;
};

export type BillingLine = {
  pallet_id: string;
  code: string;
  client_id: string;
  client_name: string;
  days: number;
  /** Storage charge / days: the tariff's daily rate, or the average when
   *  the period spans several tariffs. */
  daily_rate: number;
  storage_charge: number;
  handling_in_charge: number;
  handling_out_charge: number;
  charge: number;
  /** Every stored day has a price (from either tariff table). */
  has_tariff: boolean;
  /** A USD client tariff applied and there is no rate to convert it. */
  missing_rate: boolean;
};

export type ClientBilling = {
  client_id: string;
  client_name: string;
  /** Ventas (true) or Otras ventas (false); null when unknown. It picks the
   *  channels the client can be invoiced on. */
  client_is_fiscal: boolean | null;
  pallets: number;
  charge: number;
};

/** Storage tariff actually used in a computation — snapshotted on the billing run. */
export type AppliedTariff = {
  client_id: string | null;
  /** Present only on a general area tariff. */
  area_id?: string | null;
  rate_per_pallet: number;
  period: string;
  handling_in: number;
  handling_out: number;
  valid_from: string;
  valid_to: string | null;
};

/** Client tariff actually used, with the USD rate it was converted at. */
export type AppliedClientTariff = ClientTariffInput & {
  source: "client_tariff";
  usd_rate: number | null;
};

export type StorageBilling = {
  lines: BillingLine[];
  byClient: ClientBilling[];
  storage_total: number;
  handling_total: number;
  total: number;
  /** Pallets with stored days no tariff prices. */
  pallets_without_tariff: number;
  /** Pallets whose USD client tariff could not be converted (no rate). */
  pallets_without_rate: number;
  applied_tariffs: (AppliedTariff | AppliedClientTariff)[];
};

function dayNum(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Picks the applicable storage tariff: client-specific first, then the
 *  general one of the pallet's area, then the general one; latest
 *  valid_from within each. An area row never applies to another area. */
function pickTariff(
  tariffs: TariffInput[],
  clientId: string,
  areaId: string | null,
  periodStart: number,
  periodEnd: number,
): TariffInput | null {
  const applicable = tariffs.filter(
    (t) =>
      t.is_active &&
      (t.client_id === clientId || t.client_id === null) &&
      ((t.area_id ?? null) === null || t.area_id === areaId) &&
      dayNum(t.valid_from) <= periodEnd &&
      (t.valid_to === null || dayNum(t.valid_to) >= periodStart),
  );
  if (applicable.length === 0) return null;
  const rank = (t: TariffInput) =>
    t.client_id === clientId ? 2 : (t.area_id ?? null) !== null ? 1 : 0;
  applicable.sort((a, b) => {
    const byRank = rank(b) - rank(a);
    if (byRank !== 0) return byRank;
    return dayNum(b.valid_from) - dayNum(a.valid_from);
  });
  return applicable[0] ?? null;
}

function isGeneral(t: ClientTariffInput): boolean {
  return (t.area_id ?? null) === null;
}

/** The client tariff of `concept` in force on `day`, if any. */
function clientTariffOn(
  own: readonly ClientTariffInput[],
  concept: ClientTariffConcept,
  day: number,
): ClientTariffInput | null {
  return (
    own.find(
      (t) =>
        t.concept === concept &&
        dayNum(t.valid_from) <= day &&
        (t.valid_to === null || dayNum(t.valid_to) >= day),
    ) ?? null
  );
}

export function computeStorageBilling(input: {
  pallets: PalletInput[];
  tariffs: TariffInput[];
  clientTariffs: ClientTariffInput[];
  /** ARS per USD for the USD client tariffs; null when none is loaded. */
  usdRate: number | null;
  clientNames: Map<string, string>;
  /** Each client's side (clients.is_fiscal). */
  clientIsFiscal?: Map<string, boolean>;
  periodStart: string;
  periodEnd: string;
}): StorageBilling {
  const pStart = dayNum(input.periodStart);
  const pEnd = dayNum(input.periodEnd);

  const ownByClient = new Map<string, ClientTariffInput[]>();
  for (const t of input.clientTariffs) {
    ownByClient.set(t.client_id, [...(ownByClient.get(t.client_id) ?? []), t]);
  }

  const lines: BillingLine[] = [];
  const appliedTariffs = new Map<string, AppliedTariff | AppliedClientTariff>();
  let withoutTariff = 0;
  let withoutRate = 0;

  function recordFallback(tariff: TariffInput): void {
    const key = `${tariff.client_id ?? ""}|${tariff.area_id ?? ""}|${tariff.valid_from}|${tariff.rate_per_pallet}|${tariff.period}`;
    if (appliedTariffs.has(key)) return;
    appliedTariffs.set(key, {
      client_id: tariff.client_id,
      ...((tariff.area_id ?? null) !== null && { area_id: tariff.area_id }),
      rate_per_pallet: tariff.rate_per_pallet,
      period: tariff.period,
      handling_in: tariff.handling_in,
      handling_out: tariff.handling_out,
      valid_from: tariff.valid_from,
      valid_to: tariff.valid_to,
    });
  }

  /** `amount` of a client tariff in ARS, or null without a rate for USD. */
  function own(t: ClientTariffInput, amount: number): number | null {
    const ars = toArs(amount, t.currency, input.usdRate);
    if (ars === null) return null;
    const key = `client_tariff|${t.client_id}|${t.concept}|${t.area_id ?? ""}|${t.valid_from}`;
    if (!appliedTariffs.has(key)) {
      appliedTariffs.set(key, {
        source: "client_tariff",
        ...t,
        usd_rate: t.currency === "USD" ? input.usdRate : null,
      });
    }
    return ars;
  }

  for (const pallet of input.pallets) {
    const entry = dayNum(pallet.entry_date);
    const exit = pallet.exit_date ? dayNum(pallet.exit_date) : null;
    // Inclusive days the pallet was stored within the period.
    const start = Math.max(entry, pStart);
    const end = Math.min(exit ?? pEnd, pEnd);
    if (end < start) continue;
    const days = end - start + 1;

    const ownTariffs = ownByClient.get(pallet.client_id) ?? [];
    const area = pallet.area_id ?? null;
    // The client's tariffs for this pallet's area, and for every area.
    const areaTariffs =
      area === null ? [] : ownTariffs.filter((t) => t.area_id === area);
    const generalTariffs = ownTariffs.filter(isGeneral);
    const fallback = pickTariff(
      input.tariffs,
      pallet.client_id,
      area,
      pStart,
      pEnd,
    );
    let missingRate = false;

    // Within [start, end], the days a tariff is in force.
    const clip = (t: ClientTariffInput): [number, number] => [
      Math.max(start, dayNum(t.valid_from)),
      Math.min(end, t.valid_to === null ? end : dayNum(t.valid_to)),
    ];
    const areaStorage = areaTariffs.filter((t) => t.concept === "storage");

    // Storage: the area's tariffs on the days they cover, then the client's
    // tariffs for every area on the days left, the fallback on the rest.
    let storageCharge = 0;
    let covered = 0;
    for (const t of [...areaStorage, ...generalTariffs]) {
      if (t.concept !== "storage") continue;
      const [from, to] = clip(t);
      if (to < from) continue;
      let n = to - from + 1;
      if (isGeneral(t)) {
        for (const a of areaStorage) {
          const [af, at] = clip(a);
          n -= Math.max(0, Math.min(to, at) - Math.max(from, af) + 1);
        }
      }
      if (n <= 0) continue;
      covered += n;
      const daily = own(t, dailyPrice(t));
      if (daily === null) {
        missingRate = true;
        continue;
      }
      storageCharge += round2(n * daily);
    }
    const rest = Math.max(0, days - covered);
    let uncovered = 0;
    if (rest > 0) {
      if (fallback) {
        recordFallback(fallback);
        const daily =
          fallback.period === "monthly"
            ? fallback.rate_per_pallet / 30
            : fallback.rate_per_pallet;
        storageCharge += round2(rest * daily);
      } else {
        uncovered = rest;
      }
    }

    // Carga on the entry day and descarga on the exit day, when they fall
    // within the period.
    const handling = (
      concept: "handling_in" | "handling_out",
      day: number | null,
    ): number => {
      if (day === null || day < pStart || day > pEnd) return 0;
      const t =
        clientTariffOn(areaTariffs, concept, day) ??
        clientTariffOn(generalTariffs, concept, day);
      if (t) {
        const ars = own(t, t.price);
        if (ars === null) missingRate = true;
        return ars ?? 0;
      }
      if (!fallback) return 0;
      recordFallback(fallback);
      return fallback[concept];
    };
    const handlingIn = handling("handling_in", entry);
    const handlingOut = handling("handling_out", exit);

    if (uncovered > 0) withoutTariff += 1;
    if (missingRate) withoutRate += 1;

    storageCharge = round2(storageCharge);
    lines.push({
      pallet_id: pallet.id,
      code: pallet.code,
      client_id: pallet.client_id,
      client_name: input.clientNames.get(pallet.client_id) ?? "—",
      days,
      daily_rate: round2(storageCharge / days),
      storage_charge: storageCharge,
      handling_in_charge: round2(handlingIn),
      handling_out_charge: round2(handlingOut),
      charge: round2(storageCharge + handlingIn + handlingOut),
      has_tariff: uncovered === 0,
      missing_rate: missingRate,
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
        client_is_fiscal: input.clientIsFiscal?.get(line.client_id) ?? null,
        pallets: 1,
        charge: line.charge,
      });
    }
  }

  const byClient = [...byClientMap.values()].sort(
    (a, b) => b.charge - a.charge,
  );
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
    pallets_without_rate: withoutRate,
    applied_tariffs: [...appliedTariffs.values()],
  };
}
