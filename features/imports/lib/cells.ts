import { IVA_CONDITIONS, type IvaCondition } from "@/features/clients/schema";
import {
  DRIVER_POSITION,
  EMPLOYEE_POSITIONS,
  PAY_FREQUENCIES,
  type PayFrequency,
} from "@/features/hr/schema";
import { VEHICLE_TYPES, type VehicleType } from "@/features/vehicles/schema";
import { parseStatementNumber } from "@/lib/format";
import { normalizeHeader, parseSheetDate } from "@/lib/tables/columns";

import type { HistoricPayrollKind } from "../schema";

// A spreadsheet cell as the value a column takes. Each parser returns null
// when the text is not one it knows; the row builder says why.

const TRUE_WORDS = new Set(["si", "s", "x", "true", "1", "verdadero", "yes"]);
const FALSE_WORDS = new Set(["no", "n", "false", "0", "falso"]);

/** "Sí", "x", "1" → true; "No", "0", "" → false; anything else → null. */
export function parseYesNo(raw: string): boolean | null {
  const value = normalizeHeader(raw);
  if (value === "") return false;
  if (TRUE_WORDS.has(value)) return true;
  if (FALSE_WORDS.has(value)) return false;
  return null;
}

const IVA_ALIASES: Record<string, IvaCondition> = {
  ri: "responsable_inscripto",
  "resp inscripto": "responsable_inscripto",
  "iva responsable inscripto": "responsable_inscripto",
  monotributista: "monotributo",
  "responsable monotributo": "monotributo",
  mt: "monotributo",
  "iva exento": "exento",
  ex: "exento",
  cf: "consumidor_final",
  nc: "no_categorizado",
};

/** "Responsable Inscripto", "RI", "monotributista" → the stored value. */
export function parseIvaCondition(raw: string): IvaCondition | null {
  const value = normalizeHeader(raw);
  const direct = IVA_CONDITIONS.find((c) => c === value.replace(/ /g, "_"));
  return direct ?? IVA_ALIASES[value] ?? null;
}

const VEHICLE_TYPE_ALIASES: Record<string, VehicleType> = {
  camion: "camion",
  tractor: "camion",
  "camion tractor": "camion",
  chasis: "camion",
  acoplado: "acoplado",
  semi: "semi",
  semirremolque: "semi",
  "semi remolque": "semi",
  utilitario: "utilitario",
  camioneta: "utilitario",
  furgon: "furgon",
  auto: "auto",
  automovil: "auto",
  otro: "otro",
};

export function parseVehicleType(raw: string): VehicleType | null {
  const value = normalizeHeader(raw);
  const known = VEHICLE_TYPE_ALIASES[value];
  if (known) return known;
  return VEHICLE_TYPES.find((t) => t === value) ?? null;
}

/** Empty → mensual. */
export function parsePayFrequency(raw: string): PayFrequency | null {
  const value = normalizeHeader(raw);
  if (value === "") return "mensual";
  return PAY_FREQUENCIES.find((f) => f === value) ?? null;
}

/** A position of the form's list when it is one ("chofer" counts as the
 *  driver position); otherwise the text as written. */
export function parsePosition(raw: string): string | null {
  const value = normalizeHeader(raw);
  if (value === "") return null;
  if (/^(chofer|acompanante|conductor)( .*)?$/.test(value)) {
    return DRIVER_POSITION;
  }
  return (
    EMPLOYEE_POSITIONS.find((p) => normalizeHeader(p) === value) ?? raw.trim()
  );
}

const MONTHS: Record<string, number> = {
  enero: 1,
  ene: 1,
  febrero: 2,
  feb: 2,
  marzo: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  julio: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  septiembre: 9,
  setiembre: 9,
  sep: 9,
  sept: 9,
  set: 9,
  octubre: 10,
  oct: 10,
  noviembre: 11,
  nov: 11,
  diciembre: 12,
  dic: 12,
};

function period(year: number, month: number): string | null {
  if (month < 1 || month > 12 || year < 1990 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** "2025-10", "10/2025", "10-25", "octubre 2025", "oct-25" or a date of the
 *  month → "2025-10". */
export function parsePeriod(raw: string): string | null {
  const value = raw.trim();
  const iso = /^(\d{4})[-/](\d{1,2})$/.exec(value);
  if (iso) return period(Number(iso[1]), Number(iso[2]));
  const ar = /^(\d{1,2})[-/.](\d{2}|\d{4})$/.exec(value);
  if (ar) {
    const y = Number(ar[2]);
    return period(y < 100 ? 2000 + y : y, Number(ar[1]));
  }
  const words = /^([a-z]+)\s*(?:de\s+)?(\d{2}|\d{4})$/.exec(
    normalizeHeader(value),
  );
  if (words) {
    const month = MONTHS[words[1] ?? ""];
    const y = Number(words[2]);
    if (month) return period(y < 100 ? 2000 + y : y, month);
  }
  const date = parseSheetDate(value);
  return date ? date.slice(0, 7) : null;
}

/** Empty, "sueldo", "mensual" → monthly; "SAC", "aguinaldo" → sac. */
export function parsePayrollKind(raw: string): HistoricPayrollKind | null {
  const value = normalizeHeader(raw);
  if (["", "sueldo", "mensual", "haberes", "mes"].includes(value)) {
    return "monthly";
  }
  if (/^(sac|aguinaldo)( .*)?$/.test(value)) return "sac";
  return null;
}

export type NumberCell = { ok: true; value: number | null } | { ok: false };

/** An amount or quantity in es-AR ("1.234,56") or plain form; empty → null. */
export function parseNumberCell(raw: string): NumberCell {
  if (raw.trim() === "") return { ok: true, value: null };
  const value = parseStatementNumber(raw);
  return value === null ? { ok: false } : { ok: true, value };
}
