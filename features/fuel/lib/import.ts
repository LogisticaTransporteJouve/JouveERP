import { parseStatementNumber, round2 } from "@/lib/format";
import type { TableLimits } from "@/lib/tables/csv";

// Fuel statement import (roadmap 1.7): a YPF en Ruta or Axion Card statement
// (CSV or XLSX) read into fuel loads. Neither provider's export format is
// documented here, so each provider is a list of header aliases on top of a
// common one, matched against the header row after normalizing (lowercase,
// no accents, only letters and digits). The user can correct the mapping in
// the dialog; a new layout is a new alias, not new code.
//
// Assumptions: one row per load; a date column (dd/mm/yyyy, yyyy-mm-dd or a
// date cell, with or without a time); liters and amount as numbers in es-AR
// ("1.234,56") or plain ("1234.56") form; the vehicle by patente or by fuel
// card number (vehicles.fuel_card), a masked card ("XXXX-1234") matching by
// its last 4 digits when only one vehicle's card ends with them. Rows without
// a date and without a patente/card (titles, subtotals) are skipped.

/** A monthly statement of a few dozen trucks fits well within these. */
export const FUEL_IMPORT_LIMITS: TableLimits = {
  rows: 2000,
  columns: 40,
  cellChars: 200,
};

export const FUEL_IMPORT_PROVIDERS = [
  "ypf_en_ruta",
  "axion_card",
  "other",
] as const;
export type FuelImportProvider = (typeof FUEL_IMPORT_PROVIDERS)[number];

export const FUEL_IMPORT_PROVIDER_LABELS: Record<FuelImportProvider, string> = {
  ypf_en_ruta: "YPF en Ruta",
  axion_card: "Axion Card",
  other: "Otra planilla",
};

export const FUEL_IMPORT_FIELDS = [
  "date",
  "patente",
  "card",
  "liters",
  "amount",
  "station",
  "odometer",
  "product",
] as const;
export type FuelImportField = (typeof FUEL_IMPORT_FIELDS)[number];

export const FUEL_IMPORT_FIELD_LABELS: Record<FuelImportField, string> = {
  date: "Fecha",
  patente: "Patente",
  card: "Tarjeta",
  liters: "Litros",
  amount: "Importe",
  station: "Estación",
  odometer: "Odómetro",
  product: "Producto",
};

/** Column index per field; a field left out is not in the file. */
export type FuelImportMapping = Partial<Record<FuelImportField, number>>;

const COMMON_ALIASES: Record<FuelImportField, readonly string[]> = {
  date: ["fecha", "fecha de carga", "fecha carga", "fecha y hora", "dia"],
  patente: ["patente", "dominio", "vehiculo"],
  card: ["tarjeta", "nro tarjeta", "numero de tarjeta", "n tarjeta"],
  liters: ["litros", "lts", "cantidad", "volumen", "cantidad litros"],
  amount: ["importe", "importe total", "total", "monto", "total importe"],
  station: ["estacion", "estacion de servicio", "establecimiento", "comercio"],
  odometer: ["odometro", "kilometraje", "km", "kms"],
  product: ["producto", "combustible", "articulo"],
};

/** Extra aliases seen per provider (assumed, extend as real files arrive). */
const PROVIDER_ALIASES: Record<
  FuelImportProvider,
  Partial<Record<FuelImportField, readonly string[]>>
> = {
  ypf_en_ruta: {
    date: ["fecha transaccion", "fecha operacion", "fecha consumo"],
    card: ["nro de tarjeta", "tarjeta ypf en ruta"],
    liters: ["cantidad lts", "litros despachados"],
    amount: ["importe con impuestos", "importe final", "importe neto total"],
    station: ["razon social estacion", "boca de expendio", "apies"],
    odometer: ["odometro declarado", "km declarados"],
    product: ["descripcion producto"],
  },
  axion_card: {
    date: ["fecha de operacion", "fecha de transaccion"],
    card: ["numero tarjeta", "nro de tarjeta"],
    liters: ["unidades", "cantidad despachada"],
    amount: ["importe total con impuestos", "importe pesos"],
    station: ["estacion axion", "punto de venta"],
    odometer: ["kilometros"],
    product: ["descripcion"],
  },
  other: {},
};

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function aliasesOf(
  provider: FuelImportProvider,
): Record<FuelImportField, readonly string[]> {
  const extra = PROVIDER_ALIASES[provider];
  const out = { ...COMMON_ALIASES };
  for (const field of FUEL_IMPORT_FIELDS) {
    out[field] = [...(extra[field] ?? []), ...COMMON_ALIASES[field]];
  }
  return out;
}

/** The mapping the header row suggests: an exact alias first, then a header
 *  that starts with one ("litros despachados (lts)"). Each column is used
 *  once. */
export function suggestMapping(
  header: readonly string[],
  provider: FuelImportProvider,
): FuelImportMapping {
  const aliases = aliasesOf(provider);
  const normalized = header.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: FuelImportMapping = {};
  for (const pass of ["exact", "prefix"] as const) {
    for (const field of FUEL_IMPORT_FIELDS) {
      if (mapping[field] !== undefined) continue;
      const index = normalized.findIndex(
        (h, i) =>
          !used.has(i) &&
          h !== "" &&
          aliases[field].some((a) =>
            pass === "exact" ? h === a : h.startsWith(`${a} `),
          ),
      );
      if (index >= 0) {
        mapping[field] = index;
        used.add(index);
      }
    }
  }
  return mapping;
}

/** The header row: among the first 15, the one that maps the most fields
 *  (at least 2). -1 when none does. */
export function findHeaderRow(
  rows: readonly (readonly string[])[],
  provider: FuelImportProvider,
): number {
  let best = -1;
  let bestCount = 1;
  rows.slice(0, 15).forEach((row, i) => {
    const count = Object.keys(suggestMapping(row, provider)).length;
    if (count > bestCount) {
      best = i;
      bestCount = count;
    }
  });
  return best;
}

/** The fields an import cannot do without. */
export function missingFields(mapping: FuelImportMapping): FuelImportField[] {
  const missing: FuelImportField[] = (
    ["date", "liters", "amount"] as const
  ).filter((f) => mapping[f] === undefined);
  if (mapping.patente === undefined && mapping.card === undefined) {
    missing.push("patente");
  }
  return missing;
}

function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** "31/10/2026", "31-10-26 14:05", "2026-10-31T14:05" → "2026-10-31". */
export function parseStatementDate(raw: string): string | null {
  const value = raw.trim();
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(value);
  const ar = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:$|\s)/.exec(value);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (ar) {
    const year = Number(ar[3]);
    [y, m, d] = [year < 100 ? 2000 + year : year, Number(ar[2]), Number(ar[1])];
  } else {
    return null;
  }
  if (!isRealDate(y, m, d)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Patente or card as compared: uppercase letters and digits only. */
export function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export type ImportVehicle = {
  id: string;
  patente: string;
  fuel_card: string | null;
};

export type VehicleMatch = { vehicleId: string; patente: string };

/** The vehicle of a statement row: by patente, else by fuel card. */
export function matchVehicle(
  row: { patente: string | null; card: string | null },
  vehicles: readonly ImportVehicle[],
): VehicleMatch | null {
  const plate = row.patente ? normalizeCode(row.patente) : "";
  if (plate) {
    const v = vehicles.find((x) => normalizeCode(x.patente) === plate);
    if (v) return { vehicleId: v.id, patente: v.patente };
  }
  const rawCard = row.card?.trim() ?? "";
  if (!rawCard) return null;
  const card = normalizeCode(rawCard);
  const exact = vehicles.find((x) => x.fuel_card === card);
  if (exact) return { vehicleId: exact.id, patente: exact.patente };
  if (/[X*]/i.test(rawCard)) {
    const last4 = /(\d{4})\D*$/.exec(rawCard)?.[1];
    if (!last4) return null;
    const hits = vehicles.filter((x) => x.fuel_card?.endsWith(last4));
    const only = hits.length === 1 ? hits[0] : undefined;
    if (only) return { vehicleId: only.id, patente: only.patente };
  }
  return null;
}

/** What makes two loads the same: vehicle, day, amount and liters. */
export function fuelLoadKey(load: {
  vehicle_id: string;
  load_date: string;
  amount: number;
  liters: number;
}): string {
  return [
    load.vehicle_id,
    load.load_date,
    round2(load.amount).toFixed(2),
    round2(load.liters).toFixed(2),
  ].join("|");
}

export const FUEL_IMPORT_STATUSES = [
  "ready",
  "duplicate",
  "no_vehicle",
  "invalid",
] as const;
export type FuelImportStatus = (typeof FUEL_IMPORT_STATUSES)[number];

export type FuelImportRow = {
  /** 1-based row of the file, for the user to find it. */
  line: number;
  status: FuelImportStatus;
  /** Why it is not ready. */
  reason: string | null;
  vehicle_id: string | null;
  /** The matched vehicle's patente, else what the file says. */
  patente: string | null;
  load_date: string | null;
  liters: number | null;
  amount: number | null;
  station: string | null;
  odometer_km: number | null;
  card: string | null;
  product: string | null;
};

function cell(
  row: readonly string[],
  mapping: FuelImportMapping,
  field: FuelImportField,
): string {
  const index = mapping[field];
  return index === undefined ? "" : (row[index] ?? "").trim();
}

function text(value: string, max: number): string | null {
  return value ? value.slice(0, max) : null;
}

/**
 * Statement rows (after the header) as import rows. `existing` holds the
 * fuelLoadKey of the loads already in the system; a row repeated within the
 * file is a duplicate from its second occurrence.
 */
export function buildImportRows(input: {
  rows: readonly (readonly string[])[];
  /** Line number of rows[0] in the file. */
  firstLine: number;
  mapping: FuelImportMapping;
  vehicles: readonly ImportVehicle[];
  existing: ReadonlySet<string>;
}): FuelImportRow[] {
  const seen = new Set<string>();
  const out: FuelImportRow[] = [];
  input.rows.forEach((row, i) => {
    const rawDate = cell(row, input.mapping, "date");
    const rawPlate = cell(row, input.mapping, "patente");
    const rawCard = cell(row, input.mapping, "card");
    const loadDate = parseStatementDate(rawDate);
    if (!loadDate && !rawPlate && !rawCard) return;

    const liters = parseStatementNumber(cell(row, input.mapping, "liters"));
    const amount = parseStatementNumber(cell(row, input.mapping, "amount"));
    const odometer = parseStatementNumber(cell(row, input.mapping, "odometer"));
    const match = matchVehicle(
      { patente: rawPlate || null, card: rawCard || null },
      input.vehicles,
    );
    const base = {
      line: input.firstLine + i,
      vehicle_id: match?.vehicleId ?? null,
      patente: match?.patente ?? (rawPlate || null),
      load_date: loadDate,
      liters: liters === null ? null : round2(liters),
      amount: amount === null ? null : round2(amount),
      station: text(cell(row, input.mapping, "station"), 120),
      odometer_km:
        odometer !== null && odometer > 0 && odometer < 1e9
          ? Math.round(odometer * 10) / 10
          : null,
      card: text(rawCard, 120),
      product: text(cell(row, input.mapping, "product"), 120),
    };

    let status: FuelImportStatus = "ready";
    let reason: string | null = null;
    if (!loadDate) {
      [status, reason] = ["invalid", "Fecha ilegible."];
    } else if (base.liters === null || base.liters <= 0 || base.liters >= 1e8) {
      [status, reason] = ["invalid", "Sin litros."];
    } else if (base.amount === null || base.amount < 0 || base.amount >= 1e12) {
      [status, reason] = ["invalid", "Importe ilegible."];
    } else if (!match) {
      [status, reason] = [
        "no_vehicle",
        rawPlate || rawCard
          ? "No hay un vehículo con esa patente o tarjeta."
          : "Sin patente ni tarjeta.",
      ];
    } else {
      const key = fuelLoadKey({
        vehicle_id: match.vehicleId,
        load_date: loadDate,
        amount: base.amount,
        liters: base.liters,
      });
      if (input.existing.has(key)) {
        [status, reason] = ["duplicate", "Ya está cargada."];
      } else if (seen.has(key)) {
        [status, reason] = ["duplicate", "Repetida en el archivo."];
      }
      seen.add(key);
    }
    out.push({ ...base, status, reason });
  });
  return out;
}
