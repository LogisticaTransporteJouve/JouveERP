import { isAccountType, isCheckAccount } from "@/features/accounts/schema";
import {
  CHECK_KIND_LABEL,
  ManualChequeCreateSchema,
} from "@/features/checks/schema";
import {
  CLIENT_TARIFF_CONCEPT_LABELS,
  CLIENT_TARIFF_UNIT_LABELS,
  ClientTariffCreateSchema,
} from "@/features/client-tariffs/schema";
import { ClientCreateSchema } from "@/features/clients/schema";
import { EmployeeCreateSchema, isDriverPosition } from "@/features/hr/schema";
import { CreateLoanSchema, LOAN_KIND_LABEL } from "@/features/loans/schema";
import { SupplierCreateSchema } from "@/features/suppliers/schema";
import {
  VEHICLE_TYPE_LABELS,
  VehicleCreateSchema,
} from "@/features/vehicles/schema";
import { addDaysIso } from "@/lib/date-range";
import type { Json } from "@/lib/db/database.types";
import { formatArgentineDate, formatMoney, formatNumber2 } from "@/lib/format";
import {
  addMonthsClamped,
  generateInstallments,
} from "@/lib/loans/amortization";
import { parseSheetDate, type ColumnMapping } from "@/lib/tables/columns";

import {
  BankStatementImportRowSchema,
  HistoricPayrollRowSchema,
  HistoricTripRowSchema,
  LoanImportRowSchema,
  OpeningBalanceImportRowSchema,
  type ImportKind,
} from "../schema";
import {
  parseCheckKind,
  parseCurrency,
  parseIvaCondition,
  parseLoanKind,
  parseNumberCell,
  parsePayFrequency,
  parsePayrollKind,
  parsePeriod,
  parsePosition,
  parseTariffConcept,
  parseTariffUnit,
  parseVehicleType,
  parseYesNo,
} from "./cells";
import { IMPORT_FIELDS, fieldLabel } from "./fields";
import {
  checkKey,
  clientTariffKey,
  counterpartyKey,
  employeeKey,
  historicPayrollKey,
  loanKey,
  nameKey,
  openingBalanceKey,
  plateKey,
  vehicleKey,
} from "./keys";

// One spreadsheet row → one import row: validated with the target's Zod
// schema, matched against what is already loaded, with its natural key and
// the payload commit_import_run inserts. Pure: the action loads the lookups.

export type ImportRowStatus = "ready" | "duplicate" | "invalid";

export const IMPORT_ROW_STATUS_LABELS: Record<ImportRowStatus, string> = {
  ready: "Lista",
  duplicate: "Ya existe",
  invalid: "Con error",
};

/** What the preview shows of a row. */
export type ImportPreviewRow = {
  /** 1-based row of the file, for the user to find it. */
  line: number;
  status: ImportRowStatus;
  label: string;
  detail: string | null;
  errors: string[];
  warnings: string[];
};

/** A row's columns as the RPC reads them (jsonb_to_recordset); a loan carries
 *  its schedule as an array. */
export type ImportPayload = Record<string, Json>;

export type BuiltRow = ImportPreviewRow & {
  key: string | null;
  payload: ImportPayload | null;
};

export type ImportMapping = ColumnMapping<string>;

export type ImportLookups = {
  /** The Argentine today (YYYY-MM-DD): no historic row is in the future. */
  today: string;
  /** SHA-256 hex of a string (node:crypto in the action). */
  hash: (text: string) => string;
  employees: readonly { id: string; cuil: string | null; legal_name: string }[];
  vehicles: readonly { id: string; patente: string }[];
  drivers: readonly { id: string; full_name: string; cuit: string | null }[];
  clients: readonly {
    id: string;
    legal_name: string;
    display_name: string | null;
    cuit: string | null;
  }[];
  /** Fuel card → plateKey of the vehicle that has it. */
  fuelCards: ReadonlyMap<string, string>;
  /** historicPayrollKey of every real payroll entry (payroll_entries). */
  realPayroll: ReadonlySet<string>;
  /** The treasury account the user picked (checks: the cartera;
   *  bank_statement: the statement's account), or null. */
  account: ImportAccount | null;
  /** The channel the user picked (loans, checks), or null. */
  channelId: string | null;
  /** The general-area tariffs already loaded, for the overlap check. */
  tariffs: readonly ExistingTariff[];
};

export type ImportAccount = {
  id: string;
  name: string;
  type: string;
  currency: "ARS" | "USD";
};

export type ExistingTariff = {
  client_id: string;
  concept: string;
  valid_from: string;
  valid_to: string | null;
};

type Cells = Record<string, string>;

/** State across the rows of one file. */
type FileState = {
  fuelCards: Map<string, string>;
  tripOccurrences: Map<string, number>;
  /** client|concept → the ranges earlier rows of the file take. */
  tariffRanges: Map<string, { from: string; to: string | null }[]>;
  lineOccurrences: Map<string, number>;
};

type Built = Omit<BuiltRow, "line" | "status">;

type Issue = { path: readonly PropertyKey[]; message: string };

/** Zod issues as "<column>: <message>", skipping the columns already
 *  reported; an English default message reads as "valor inválido". */
function issueErrors(
  kind: ImportKind,
  issues: readonly Issue[],
  reported: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (reported.has(key)) continue;
    const message = /^(Invalid|Too|Expected)/.test(issue.message)
      ? "valor inválido."
      : issue.message;
    const line = key ? `${fieldLabel(kind, key)}: ${message}` : message;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

function text(cells: Cells, key: string): string {
  return cells[key] ?? "";
}

function orNull(value: string): string | null {
  const v = value.trim();
  return v === "" ? null : v;
}

function invalid(label: string, errors: string[], warnings: string[]): Built {
  return { label, detail: null, errors, warnings, key: null, payload: null };
}

/** A number column: an error when it is not a number. */
function numberCell(
  kind: ImportKind,
  cells: Cells,
  key: string,
  errors: string[],
  reported: Set<string>,
): number | null {
  const cell = parseNumberCell(text(cells, key));
  if (cell.ok) return cell.value;
  errors.push(`${fieldLabel(kind, key)}: no es un número.`);
  reported.add(key);
  return null;
}

/** A date column: an error when it is written but not a date. */
function dateCell(
  kind: ImportKind,
  cells: Cells,
  key: string,
  errors: string[],
  reported: Set<string>,
  required: boolean,
): string | null {
  const raw = text(cells, key);
  if (raw === "") {
    if (required) {
      errors.push(`Falta ${fieldLabel(kind, key).toLowerCase()}.`);
      reported.add(key);
    }
    return null;
  }
  const date = parseSheetDate(raw);
  if (!date) {
    errors.push(`${fieldLabel(kind, key)}: fecha ilegible ("${raw}").`);
    reported.add(key);
  }
  return date;
}

function cuitDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

// ─── Clients and suppliers ───────────────────────────────────────────────────

function buildCounterparty(kind: "clients" | "suppliers", cells: Cells): Built {
  const errors: string[] = [];
  const warnings: string[] = [];
  const reported = new Set<string>();
  const legalName = text(cells, "legal_name");
  const cuitRaw = text(cells, "cuit");
  const ivaRaw = text(cells, "iva_condition");
  const fiscal = cuitDigits(cuitRaw) !== "";

  let candidate: Record<string, unknown>;
  if (fiscal) {
    const iva = parseIvaCondition(ivaRaw);
    if (!ivaRaw) {
      errors.push("Falta la condición de IVA (con CUIT es obligatoria).");
      reported.add("iva_condition");
    } else if (!iva) {
      errors.push(`Condición de IVA desconocida: "${ivaRaw}".`);
      reported.add("iva_condition");
    }
    candidate = {
      is_fiscal: true,
      cuit: cuitRaw,
      legal_name: legalName,
      display_name: text(cells, "display_name"),
      iva_condition: iva ?? "",
      email: text(cells, "email"),
      phone: text(cells, "phone"),
      address: text(cells, "address"),
      real_address: text(cells, "real_address"),
      notes: text(cells, "notes"),
    };
  } else {
    if (ivaRaw || text(cells, "address")) {
      warnings.push(
        "Sin CUIT: entra como interno; la condición de IVA y el domicilio fiscal no se guardan.",
      );
    }
    candidate = {
      is_fiscal: false,
      legal_name: legalName,
      display_name: text(cells, "display_name"),
      email: text(cells, "email"),
      phone: text(cells, "phone"),
      real_address: text(cells, "real_address"),
      notes: text(cells, "notes"),
    };
  }

  const schema = kind === "clients" ? ClientCreateSchema : SupplierCreateSchema;
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    errors.push(...issueErrors(kind, parsed.error.issues, reported));
  }
  const label = legalName || "(sin razón social)";
  if (!parsed.success || errors.length > 0) {
    return invalid(label, errors, warnings);
  }
  const d = parsed.data;
  const payload: ImportPayload = {
    legal_name: d.legal_name,
    display_name: d.display_name ?? null,
    cuit: d.is_fiscal ? d.cuit : null,
    iva_condition: d.is_fiscal ? d.iva_condition : null,
    email: d.email ?? null,
    phone: d.phone ?? null,
    address: d.is_fiscal ? (d.address ?? null) : null,
    real_address: d.real_address ?? null,
    notes: d.notes ?? null,
    is_fiscal: d.is_fiscal,
  };
  return {
    label: d.legal_name,
    detail: d.is_fiscal ? `CUIT ${d.cuit}` : "Sin CUIT · interno",
    errors,
    warnings,
    key: counterpartyKey({
      cuit: d.is_fiscal ? d.cuit : null,
      legal_name: d.legal_name,
    }),
    payload,
  };
}

// ─── Employees ───────────────────────────────────────────────────────────────

function buildEmployee(cells: Cells): Built {
  const kind = "employees";
  const errors: string[] = [];
  const warnings: string[] = [];
  const reported = new Set<string>();
  const legalName = text(cells, "legal_name");

  const hire = dateCell(kind, cells, "hire_date", errors, reported, true);
  const termination = dateCell(
    kind,
    cells,
    "termination_date",
    errors,
    reported,
    false,
  );
  if (hire && termination && termination < hire) {
    errors.push("La fecha de egreso es anterior a la de ingreso.");
  }
  const payFrequency = parsePayFrequency(text(cells, "pay_frequency"));
  if (!payFrequency) {
    errors.push(
      `Frecuencia de pago desconocida: "${text(cells, "pay_frequency")}".`,
    );
    reported.add("pay_frequency");
  }
  const monotributo = parseYesNo(text(cells, "is_monotributo"));
  if (monotributo === null) {
    errors.push("Monotributista: poné Sí o No.");
    reported.add("is_monotributo");
  }
  const baseSalary = numberCell(kind, cells, "base_salary", errors, reported);
  const viatico = numberCell(kind, cells, "viatico_monthly", errors, reported);
  const position = parsePosition(text(cells, "position"));

  const parsed = EmployeeCreateSchema.safeParse({
    legal_name: legalName,
    position: position ?? "",
    cuil: text(cells, "cuil"),
    cbu: text(cells, "cbu"),
    pay_frequency: payFrequency ?? "",
    base_salary: baseSalary ?? "",
    viatico_monthly: viatico ?? 0,
    is_monotributo: monotributo ?? false,
    hire_date: hire ?? "",
    notes: text(cells, "notes"),
    convenio: text(cells, "convenio"),
    categoria: text(cells, "categoria"),
    obra_social: text(cells, "obra_social"),
    art: text(cells, "art"),
  });
  if (!parsed.success) {
    errors.push(...issueErrors(kind, parsed.error.issues, reported));
  }
  const label = legalName || "(sin nombre)";
  if (!parsed.success || errors.length > 0 || !hire) {
    return invalid(label, errors, warnings);
  }
  const d = parsed.data;
  if (!d.cuil) warnings.push("Sin CUIL: se compara por nombre.");
  if (isDriverPosition(d.position)) {
    warnings.push("Es chofer: se crea también su ficha de chofer.");
  }
  if (termination) warnings.push("Tiene fecha de egreso: entra inactivo.");
  return {
    label: d.legal_name,
    detail: [d.cuil ? `CUIL ${d.cuil}` : "Sin CUIL", d.position]
      .filter(Boolean)
      .join(" · "),
    errors,
    warnings,
    key: employeeKey({ cuil: d.cuil ?? null, legal_name: d.legal_name }),
    payload: {
      legal_name: d.legal_name,
      position: d.position ?? null,
      cuil: d.cuil ?? null,
      cbu: d.cbu ?? null,
      pay_frequency: d.pay_frequency,
      base_salary: d.base_salary ?? null,
      viatico_monthly: d.viatico_monthly,
      is_monotributo: d.is_monotributo,
      hire_date: d.hire_date,
      termination_date: termination,
      notes: d.notes ?? null,
      convenio: d.convenio ?? null,
      categoria: d.categoria ?? null,
      obra_social: d.obra_social ?? null,
      art: d.art ?? null,
    },
  };
}

// ─── Vehicles ────────────────────────────────────────────────────────────────

function buildVehicle(
  cells: Cells,
  lookups: ImportLookups,
  state: FileState,
): Built {
  const kind = "vehicles";
  const errors: string[] = [];
  const reported = new Set<string>();
  const patente = text(cells, "patente").toUpperCase();
  const typeRaw = text(cells, "vehicle_type");
  const type = parseVehicleType(typeRaw);
  if (!type) {
    errors.push(
      typeRaw
        ? `Tipo desconocido: "${typeRaw}".`
        : "Falta el tipo de vehículo.",
    );
    reported.add("vehicle_type");
  }
  const year = numberCell(kind, cells, "year", errors, reported);
  const capacity = numberCell(kind, cells, "capacity_kg", errors, reported);

  const parsed = VehicleCreateSchema.safeParse({
    patente,
    vehicle_type: type ?? "",
    alias: text(cells, "alias"),
    brand: text(cells, "brand"),
    model: text(cells, "model"),
    year: year ?? "",
    fleet: text(cells, "fleet"),
    fuel_card: text(cells, "fuel_card"),
    capacity_kg: capacity ?? "",
    notes: text(cells, "notes"),
  });
  if (!parsed.success) {
    errors.push(...issueErrors(kind, parsed.error.issues, reported));
  }
  const label = patente || "(sin patente)";
  if (!parsed.success || errors.length > 0) {
    return invalid(label, errors, []);
  }
  const d = parsed.data;
  const plate = plateKey(d.patente);
  if (d.fuel_card) {
    const owner = lookups.fuelCards.get(d.fuel_card);
    const inFile = state.fuelCards.get(d.fuel_card);
    if (owner !== undefined && owner !== plate) {
      return invalid(
        label,
        ["La tarjeta de combustible ya es de otro vehículo."],
        [],
      );
    }
    if (inFile !== undefined && inFile !== plate) {
      return invalid(
        label,
        ["La tarjeta de combustible se repite en otro vehículo del archivo."],
        [],
      );
    }
    state.fuelCards.set(d.fuel_card, plate);
  }
  return {
    label: d.patente,
    detail: VEHICLE_TYPE_LABELS[d.vehicle_type],
    errors,
    warnings: [],
    key: vehicleKey(d.patente),
    payload: {
      patente: d.patente,
      vehicle_type: d.vehicle_type,
      alias: d.alias ?? null,
      brand: d.brand ?? null,
      model: d.model ?? null,
      year: d.year ?? null,
      fleet: d.fleet ?? null,
      fuel_card: d.fuel_card ?? null,
      capacity_kg: d.capacity_kg ?? null,
      notes: d.notes ?? null,
    },
  };
}

// ─── Historic payroll ────────────────────────────────────────────────────────

type Match<T> = { found: T | null; error: string | null };

function matchEmployee(
  cells: Cells,
  lookups: ImportLookups,
): Match<ImportLookups["employees"][number]> {
  const name = text(cells, "employee");
  const cuil = cuitDigits(text(cells, "cuil"));
  if (cuil.length === 11) {
    const byCuil = lookups.employees.find((e) => e.cuil === cuil);
    return byCuil
      ? { found: byCuil, error: null }
      : { found: null, error: `No hay un empleado con CUIL ${cuil}.` };
  }
  if (!name) return { found: null, error: "Falta el empleado." };
  const hits = lookups.employees.filter(
    (e) => nameKey(e.legal_name) === nameKey(name),
  );
  if (hits.length === 1 && hits[0]) return { found: hits[0], error: null };
  return {
    found: null,
    error:
      hits.length === 0
        ? `No hay un empleado "${name}": importalo primero o usá el CUIL.`
        : `Hay más de un empleado "${name}": usá el CUIL.`,
  };
}

function buildHistoricPayroll(cells: Cells, lookups: ImportLookups): Built {
  const kind = "historic_payroll";
  const errors: string[] = [];
  const warnings: string[] = [];
  const reported = new Set<string>();

  const employee = matchEmployee(cells, lookups);
  if (employee.error) errors.push(employee.error);
  if (
    employee.found &&
    text(cells, "employee") &&
    nameKey(text(cells, "employee")) !== nameKey(employee.found.legal_name)
  ) {
    warnings.push(
      `El nombre no coincide con el del CUIL: se usa ${employee.found.legal_name}.`,
    );
  }

  const periodRaw = text(cells, "period");
  const period = parsePeriod(periodRaw);
  if (!period) {
    errors.push(
      periodRaw ? `Período ilegible ("${periodRaw}").` : "Falta el período.",
    );
  } else if (period > lookups.today.slice(0, 7)) {
    errors.push("El período es futuro.");
  }
  const payrollKind = parsePayrollKind(text(cells, "kind"));
  if (!payrollKind) {
    errors.push(`Tipo desconocido: "${text(cells, "kind")}".`);
    reported.add("kind");
  }
  const net = numberCell(kind, cells, "net_amount", errors, reported);
  if (net === null && !reported.has("net_amount")) {
    errors.push("Falta el neto.");
    reported.add("net_amount");
  }
  const paid = numberCell(kind, cells, "paid_amount", errors, reported);
  const paidOn = dateCell(kind, cells, "paid_on", errors, reported, false);

  const label = employee.found?.legal_name ?? (text(cells, "employee") || "—");
  if (errors.length > 0 || !employee.found || !period || !payrollKind) {
    return invalid(label, errors, warnings);
  }
  const parsed = HistoricPayrollRowSchema.safeParse({
    employee_id: employee.found.id,
    period,
    kind: payrollKind,
    net_amount: net,
    paid_amount: paid,
    paid_on: paidOn,
    notes: orNull(text(cells, "notes")),
  });
  if (!parsed.success) {
    return invalid(
      label,
      issueErrors(kind, parsed.error.issues, reported),
      warnings,
    );
  }
  const d = parsed.data;
  const key = historicPayrollKey(d);
  if (lookups.realPayroll.has(key)) {
    warnings.push(
      "Ya hay una planilla de ese mes en el sistema: el histórico queda solo como referencia.",
    );
  }
  if (d.paid_amount !== null && d.paid_amount > d.net_amount) {
    warnings.push("Lo pagado supera el neto.");
  }
  return {
    label,
    detail: [
      d.period,
      d.kind === "sac" ? "Aguinaldo" : null,
      `Neto ${formatMoney(d.net_amount)}`,
      d.paid_amount === null ? null : `Pagado ${formatMoney(d.paid_amount)}`,
    ]
      .filter(Boolean)
      .join(" · "),
    errors,
    warnings,
    key,
    payload: { ...d },
  };
}

// ─── Historic trips ──────────────────────────────────────────────────────────

/** The records among `items` that `raw` names: by CUIT/CUIL when it is 11
 *  digits, else by any of their names. */
function findByNameOrCuit<T>(
  raw: string,
  items: readonly T[],
  names: (item: T) => (string | null)[],
  cuit: (item: T) => string | null,
): T[] {
  const digits = cuitDigits(raw);
  return digits.length === 11 &&
    digits.length === raw.replace(/[\s.-]/g, "").length
    ? items.filter((i) => cuit(i) === digits)
    : items.filter((i) =>
        names(i).some((n) => n !== null && nameKey(n) === nameKey(raw)),
      );
}

/** One record among `items` named `raw` (a CUIT/CUIL of 11 digits, else the
 *  name): its id, or a warning and no id. */
function matchByName<T extends { id: string }>(
  raw: string,
  items: readonly T[],
  names: (item: T) => (string | null)[],
  cuit: (item: T) => string | null,
  what: string,
): { id: string | null; warning: string | null } {
  if (!raw) return { id: null, warning: null };
  const hits = findByNameOrCuit(raw, items, names, cuit);
  const only = hits.length === 1 ? hits[0] : undefined;
  if (only) return { id: only.id, warning: null };
  return {
    id: null,
    warning:
      hits.length === 0
        ? `No hay un ${what} "${raw}": se guarda el texto.`
        : `Hay más de un ${what} "${raw}": se guarda el texto.`,
  };
}

function buildHistoricTrip(
  cells: Cells,
  lookups: ImportLookups,
  state: FileState,
): Built {
  const kind = "historic_trips";
  const errors: string[] = [];
  const warnings: string[] = [];
  const reported = new Set<string>();

  const date = dateCell(kind, cells, "trip_date", errors, reported, true);
  if (date && date > lookups.today) errors.push("La fecha es futura.");
  const km = numberCell(kind, cells, "km", errors, reported);
  const freight = numberCell(kind, cells, "freight_amount", errors, reported);

  const patente = text(cells, "patente");
  const driver = text(cells, "driver");
  const client = text(cells, "client");
  const origin = orNull(text(cells, "origin"));
  const destination = orNull(text(cells, "destination"));
  if (
    !patente &&
    !driver &&
    !client &&
    !origin &&
    !destination &&
    km === null &&
    freight === null
  ) {
    errors.push("La fila no tiene datos del viaje, solo la fecha.");
  }

  const vehicle = patente
    ? lookups.vehicles.find((v) => plateKey(v.patente) === plateKey(patente))
    : undefined;
  if (patente && !vehicle) {
    warnings.push(`No hay un vehículo ${patente}: se guarda el texto.`);
  }
  const driverMatch = matchByName(
    driver,
    lookups.drivers,
    (d) => [d.full_name],
    (d) => d.cuit,
    "chofer",
  );
  const clientMatch = matchByName(
    client,
    lookups.clients,
    (c) => [c.legal_name, c.display_name],
    (c) => c.cuit,
    "cliente",
  );
  for (const w of [driverMatch.warning, clientMatch.warning]) {
    if (w) warnings.push(w);
  }

  const routeLabel = `${origin ?? "—"} → ${destination ?? "—"}`;
  const label = date
    ? `${formatArgentineDate(date)} · ${routeLabel}`
    : routeLabel;
  if (errors.length > 0 || !date) return invalid(label, errors, warnings);

  // The row's content and its repetition in the file: the same file imported
  // again gives the same hashes, two equal trips of one day stay two.
  const content = [
    date,
    plateKey(patente),
    nameKey(driver),
    nameKey(client),
    nameKey(origin ?? ""),
    nameKey(destination ?? ""),
    km === null ? "" : km.toFixed(1),
    freight === null ? "" : freight.toFixed(2),
  ].join("|");
  const occurrence = (state.tripOccurrences.get(content) ?? 0) + 1;
  state.tripOccurrences.set(content, occurrence);

  const parsed = HistoricTripRowSchema.safeParse({
    trip_date: date,
    vehicle_id: vehicle?.id ?? null,
    vehicle_label: orNull(patente),
    driver_id: driverMatch.id,
    driver_label: orNull(driver),
    client_id: clientMatch.id,
    client_label: orNull(client),
    origin,
    destination,
    km,
    freight_amount: freight,
    notes: orNull(text(cells, "notes")),
    source_hash: lookups.hash(`${content}|${occurrence}`),
  });
  if (!parsed.success) {
    return invalid(
      label,
      issueErrors(kind, parsed.error.issues, reported),
      warnings,
    );
  }
  const d = parsed.data;
  return {
    label,
    detail: [
      vehicle?.patente ?? d.vehicle_label,
      d.freight_amount === null
        ? null
        : `Flete ${formatMoney(d.freight_amount)}`,
      d.km === null ? null : `${formatNumber2(d.km)} km`,
    ]
      .filter(Boolean)
      .join(" · "),
    errors,
    warnings,
    key: d.source_hash,
    payload: { ...d },
  };
}

// ─── Go-live items (5.3) ─────────────────────────────────────────────────────

type ImportClient = ImportLookups["clients"][number];

/** The client a cell names (CUIT, legal or trade name); an error when none
 *  or more than one matches. */
function matchClient(raw: string, lookups: ImportLookups): Match<ImportClient> {
  if (!raw) return { found: null, error: "Falta el cliente." };
  const hits = findByNameOrCuit(
    raw,
    lookups.clients,
    (c) => [c.legal_name, c.display_name],
    (c) => c.cuit,
  );
  const only = hits.length === 1 ? hits[0] : undefined;
  if (only) return { found: only, error: null };
  return {
    found: null,
    error:
      hits.length === 0
        ? `No hay un cliente "${raw}": importalo o cargalo primero.`
        : `Hay más de un cliente "${raw}": usá el CUIT.`,
  };
}

function rangesOverlap(
  a: { from: string; to: string | null },
  b: { from: string; to: string | null },
): boolean {
  return (a.to === null || a.to >= b.from) && (b.to === null || b.to >= a.from);
}

function buildClientTariff(
  cells: Cells,
  lookups: ImportLookups,
  state: FileState,
): Built {
  const kind = "client_tariffs";
  const errors: string[] = [];
  const warnings: string[] = [];
  const reported = new Set<string>();

  const client = matchClient(text(cells, "client"), lookups);
  if (client.error) errors.push(client.error);
  const conceptRaw = text(cells, "concept");
  const concept = parseTariffConcept(conceptRaw);
  if (!concept) {
    errors.push(
      conceptRaw
        ? `Concepto desconocido: "${conceptRaw}".`
        : "Falta el concepto.",
    );
    reported.add("concept");
  }
  const unit = concept ? parseTariffUnit(text(cells, "unit"), concept) : null;
  if (concept && !unit) {
    errors.push(`Unidad desconocida: "${text(cells, "unit")}".`);
    reported.add("unit");
  }
  const price = numberCell(kind, cells, "price", errors, reported);
  if (price === null && !reported.has("price")) {
    errors.push("Falta el precio.");
    reported.add("price");
  }
  const currency = parseCurrency(text(cells, "currency"), "ARS");
  if (!currency) {
    errors.push(`Moneda desconocida: "${text(cells, "currency")}".`);
    reported.add("currency");
  }
  const from = dateCell(kind, cells, "valid_from", errors, reported, true);
  const to = dateCell(kind, cells, "valid_to", errors, reported, false);

  const label = client.found?.legal_name ?? (text(cells, "client") || "—");
  if (errors.length > 0 || !client.found || !concept || !from) {
    return invalid(label, errors, warnings);
  }
  const parsed = ClientTariffCreateSchema.safeParse({
    client_id: client.found.id,
    concept,
    unit: unit ?? "",
    price: price ?? "",
    currency: currency ?? "",
    valid_from: from,
    valid_to: to ?? "",
    notes: text(cells, "notes"),
  });
  if (!parsed.success) {
    return invalid(
      label,
      issueErrors(kind, parsed.error.issues, reported),
      warnings,
    );
  }
  const d = parsed.data;
  const range = { from: d.valid_from, to: d.valid_to ?? null };
  const key = clientTariffKey(d);
  // The same start is the same tariff (a re-import skips it); any other
  // overlap would be refused by guard_client_tariff_overlap.
  const clash = lookups.tariffs.find(
    (t) =>
      t.client_id === d.client_id &&
      t.concept === d.concept &&
      t.valid_from !== d.valid_from &&
      rangesOverlap(range, { from: t.valid_from, to: t.valid_to }),
  );
  if (clash) {
    return invalid(
      label,
      [
        `Se superpone con la tarifa vigente del ${formatArgentineDate(clash.valid_from)} ${clash.valid_to ? `al ${formatArgentineDate(clash.valid_to)}` : "sin fin"}: cerrala antes.`,
      ],
      warnings,
    );
  }
  const lineKey = `${d.client_id}|${d.concept}`;
  const taken = state.tariffRanges.get(lineKey) ?? [];
  if (taken.some((r) => r.from !== range.from && rangesOverlap(r, range))) {
    return invalid(
      label,
      [
        "Se superpone con otra tarifa del archivo del mismo cliente y concepto.",
      ],
      warnings,
    );
  }
  state.tariffRanges.set(lineKey, [...taken, range]);
  return {
    label,
    detail: [
      CLIENT_TARIFF_CONCEPT_LABELS[d.concept],
      CLIENT_TARIFF_UNIT_LABELS[d.unit],
      formatMoney(d.price, d.currency),
      d.valid_to
        ? `${formatArgentineDate(d.valid_from)} al ${formatArgentineDate(d.valid_to)}`
        : `desde ${formatArgentineDate(d.valid_from)}`,
    ].join(" · "),
    errors,
    warnings,
    key,
    payload: {
      client_id: d.client_id,
      concept: d.concept,
      unit: d.unit,
      price: d.price,
      currency: d.currency,
      valid_from: d.valid_from,
      valid_to: d.valid_to ?? null,
      notes: d.notes ?? null,
    },
  };
}

function buildLoan(cells: Cells, lookups: ImportLookups): Built {
  const kind = "loans";
  const errors: string[] = [];
  const warnings: string[] = [];
  const reported = new Set<string>();

  const description = text(cells, "description");
  const loanKind = parseLoanKind(text(cells, "kind"));
  if (!loanKind) {
    errors.push(`Tipo desconocido: "${text(cells, "kind")}".`);
    reported.add("kind");
  }
  const currency = parseCurrency(text(cells, "currency"), "ARS");
  if (!currency) {
    errors.push(`Moneda desconocida: "${text(cells, "currency")}".`);
    reported.add("currency");
  }
  const principal = numberCell(kind, cells, "principal", errors, reported);
  const count = numberCell(kind, cells, "installments_count", errors, reported);
  const first = dateCell(kind, cells, "first_due_date", errors, reported, true);
  const cuota = numberCell(kind, cells, "installment_amount", errors, reported);
  if (!lookups.channelId) errors.push("Elegí el canal de los préstamos.");

  const label = description || "(sin descripción)";
  if (errors.length > 0 || !first || !lookups.channelId) {
    return invalid(label, errors, warnings);
  }
  const parsed = CreateLoanSchema.safeParse({
    kind: loanKind ?? "",
    description,
    lender: text(cells, "lender"),
    principal: principal ?? "",
    currency: currency ?? "",
    channel_id: lookups.channelId,
    installments_count: count ?? "",
    first_due_date: first,
    notes: text(cells, "notes"),
  });
  if (!parsed.success) {
    return invalid(
      label,
      issueErrors(kind, parsed.error.issues, reported),
      warnings,
    );
  }
  const d = parsed.data;
  if (cuota !== null && cuota <= 0) {
    return invalid(
      label,
      ["Importe de cuota: tiene que ser mayor a cero."],
      warnings,
    );
  }
  // As the loan dialog: equal cuotas of the capital, or the cuota the file
  // gives (capital plus interest) for each pending one.
  const schedule =
    cuota === null
      ? generateInstallments(
          d.principal,
          d.installments_count,
          d.first_due_date,
        )
      : Array.from({ length: d.installments_count }, (_, i) => ({
          number: i + 1,
          due_date: addMonthsClamped(d.first_due_date, i),
          amount: cuota,
        }));
  const row = LoanImportRowSchema.safeParse({
    kind: d.kind,
    description: d.description,
    lender: d.lender ?? null,
    principal: d.principal,
    currency: d.currency,
    channel_id: d.channel_id,
    installments_count: d.installments_count,
    first_due_date: d.first_due_date,
    notes: d.notes ?? null,
    installments: schedule,
  });
  if (!row.success) {
    return invalid(
      label,
      issueErrors(kind, row.error.issues, reported),
      warnings,
    );
  }
  const r = row.data;
  if (r.first_due_date < lookups.today) {
    warnings.push(
      "El próximo vencimiento ya pasó: esa cuota queda pendiente de pago.",
    );
  }
  const total = schedule.reduce((sum, i) => sum + i.amount, 0);
  if (cuota !== null && total < r.principal) {
    warnings.push("Las cuotas suman menos que el capital pendiente.");
  }
  return {
    label: r.description,
    detail: [
      r.lender,
      LOAN_KIND_LABEL[r.kind],
      `Capital ${formatMoney(r.principal, r.currency)}`,
      `${r.installments_count} ${r.installments_count === 1 ? "cuota" : "cuotas"} desde ${formatArgentineDate(r.first_due_date)}`,
    ]
      .filter(Boolean)
      .join(" · "),
    errors,
    warnings,
    key: loanKey(r),
    payload: { ...r },
  };
}

function buildCheck(cells: Cells, lookups: ImportLookups): Built {
  const kind = "checks";
  const errors: string[] = [];
  const warnings: string[] = [];
  const reported = new Set<string>();
  const account = lookups.account;
  const label =
    [text(cells, "bank_name"), text(cells, "check_number")]
      .filter(Boolean)
      .join(" #") || "(sin número)";

  if (
    !account ||
    !isCheckAccount(isAccountType(account.type) ? account.type : undefined)
  ) {
    return invalid(
      label,
      ["Elegí la cuenta de cartera de los cheques."],
      warnings,
    );
  }
  if (!lookups.channelId) {
    return invalid(label, ["Elegí el canal de los cheques."], warnings);
  }
  const accountKind = account.type === "echeq" ? "echeq" : "fisico";
  const checkKind = parseCheckKind(text(cells, "kind"), accountKind);
  if (!checkKind) {
    errors.push(`Tipo desconocido: "${text(cells, "kind")}".`);
    reported.add("kind");
  } else if (checkKind !== accountKind) {
    errors.push(
      checkKind === "echeq"
        ? "Es un e-cheq: va a una cuenta de e-cheq en cartera."
        : "Es un cheque físico: va a una cuenta de cheques físicos en cartera.",
    );
    reported.add("kind");
  }
  const currency = parseCurrency(text(cells, "currency"), account.currency);
  if (!currency) {
    errors.push(`Moneda desconocida: "${text(cells, "currency")}".`);
    reported.add("currency");
  } else if (currency !== account.currency) {
    errors.push(`La cuenta de cartera es en ${account.currency}.`);
    reported.add("currency");
  }
  const amount = numberCell(kind, cells, "amount", errors, reported);
  const issue = dateCell(kind, cells, "issue_date", errors, reported, true);
  const due = dateCell(kind, cells, "due_date", errors, reported, true);
  if (errors.length > 0 || !issue || !due) {
    return invalid(label, errors, warnings);
  }
  const parsed = ManualChequeCreateSchema.safeParse({
    kind: checkKind ?? "",
    check_number: text(cells, "check_number"),
    bank_name: text(cells, "bank_name"),
    drawer_name: text(cells, "drawer_name"),
    drawer_cuit: text(cells, "drawer_cuit"),
    issue_date: issue,
    due_date: due,
    amount: amount ?? "",
    currency: currency ?? "",
    cartera_account_id: account.id,
    channel_id: lookups.channelId,
    source_kind: "manual",
    notes: text(cells, "notes"),
  });
  if (!parsed.success) {
    return invalid(
      label,
      issueErrors(kind, parsed.error.issues, reported),
      warnings,
    );
  }
  const d = parsed.data;
  if (d.due_date < d.issue_date) {
    return invalid(
      label,
      ["La fecha de pago es anterior a la de emisión."],
      warnings,
    );
  }
  if (d.issue_date > lookups.today) {
    warnings.push("La fecha de emisión es futura.");
  }
  // A check can be deposited up to 30 days after its payment date.
  if (addDaysIso(d.due_date, 30) < lookups.today) {
    warnings.push("Venció hace más de 30 días: revisá que siga en cartera.");
  }
  return {
    label: `${d.bank_name} #${d.check_number}`,
    detail: [
      d.drawer_name,
      CHECK_KIND_LABEL[d.kind],
      formatMoney(d.amount, d.currency),
      `paga el ${formatArgentineDate(d.due_date)}`,
    ].join(" · "),
    errors,
    warnings,
    key: checkKey(d),
    payload: {
      kind: d.kind,
      check_number: d.check_number,
      bank_name: d.bank_name,
      drawer_name: d.drawer_name,
      drawer_cuit: d.drawer_cuit ?? null,
      issue_date: d.issue_date,
      due_date: d.due_date,
      amount: d.amount,
      currency: d.currency,
      cartera_account_id: d.cartera_account_id,
      channel_id: d.channel_id,
      notes: d.notes ?? null,
    },
  };
}

function buildOpeningBalance(cells: Cells, lookups: ImportLookups): Built {
  const kind = "opening_balances";
  const errors: string[] = [];
  const warnings: string[] = [];
  const reported = new Set<string>();

  const client = matchClient(text(cells, "client"), lookups);
  if (client.error) errors.push(client.error);
  const balance = numberCell(kind, cells, "target_balance", errors, reported);
  if (balance === null && !reported.has("target_balance")) {
    errors.push("Falta el saldo.");
  } else if (balance !== null && balance < 0) {
    errors.push(
      "Un saldo a favor del cliente no se carga acá: registralo como recibo a cuenta.",
    );
  }
  const date = dateCell(kind, cells, "opening_date", errors, reported, true);
  if (date && date > lookups.today) errors.push("La fecha de corte es futura.");

  const label = client.found?.legal_name ?? (text(cells, "client") || "—");
  if (errors.length > 0 || !client.found || !date) {
    return invalid(label, errors, warnings);
  }
  const parsed = OpeningBalanceImportRowSchema.safeParse({
    client_id: client.found.id,
    opening_date: date,
    target_balance: balance,
    notes: orNull(text(cells, "notes")),
  });
  if (!parsed.success) {
    return invalid(
      label,
      issueErrors(kind, parsed.error.issues, reported),
      warnings,
    );
  }
  const d = parsed.data;
  return {
    label,
    detail: `Debe ${formatMoney(d.target_balance)} al ${formatArgentineDate(d.opening_date)}`,
    errors,
    warnings,
    key: openingBalanceKey(d.client_id),
    payload: { ...d },
  };
}

/** Amount of a statement line: the signed column, else credit minus debit
 *  (each read as positive). */
function statementAmount(
  cells: Cells,
  errors: string[],
  reported: Set<string>,
): number | null {
  const kind = "bank_statement";
  if (text(cells, "amount") !== "") {
    return numberCell(kind, cells, "amount", errors, reported);
  }
  const debit = numberCell(kind, cells, "debit", errors, reported);
  const credit = numberCell(kind, cells, "credit", errors, reported);
  if (debit === null && credit === null) return null;
  return Math.round((Math.abs(credit ?? 0) - Math.abs(debit ?? 0)) * 100) / 100;
}

function buildStatementLine(
  cells: Cells,
  lookups: ImportLookups,
  state: FileState,
): Built {
  const kind = "bank_statement";
  const errors: string[] = [];
  const warnings: string[] = [];
  const reported = new Set<string>();
  const account = lookups.account;
  const description = text(cells, "description");

  const date = dateCell(kind, cells, "line_date", errors, reported, true);
  if (date && date > lookups.today) errors.push("La fecha es futura.");
  const amount = statementAmount(cells, errors, reported);
  if (amount === null && errors.length === 0) {
    errors.push("La línea no tiene importe.");
  }
  const balance = numberCell(kind, cells, "balance", errors, reported);
  const reference = orNull(text(cells, "reference"));

  const label = date
    ? `${formatArgentineDate(date)} · ${description || "—"}`
    : description || "—";
  if (
    !account ||
    (isAccountType(account.type) && isCheckAccount(account.type))
  ) {
    return invalid(
      label,
      ["Elegí la cuenta del extracto (banco, billetera, caja o inversión)."],
      warnings,
    );
  }
  if (errors.length > 0 || !date || amount === null) {
    return invalid(label, errors, warnings);
  }

  // The line's content and its repetition in the file: the same statement
  // imported again (or one that overlaps it) gives the same hashes, two equal
  // movements of one day stay two.
  const content = [
    account.id,
    date,
    nameKey(description),
    amount.toFixed(2),
    balance === null ? "" : balance.toFixed(2),
    nameKey(reference ?? ""),
  ].join("|");
  const occurrence = (state.lineOccurrences.get(content) ?? 0) + 1;
  state.lineOccurrences.set(content, occurrence);

  const parsed = BankStatementImportRowSchema.safeParse({
    account_id: account.id,
    line_date: date,
    description,
    amount,
    balance,
    reference,
    source_hash: lookups.hash(`${content}|${occurrence}`),
  });
  if (!parsed.success) {
    return invalid(
      label,
      issueErrors(kind, parsed.error.issues, reported),
      warnings,
    );
  }
  const d = parsed.data;
  return {
    label,
    detail: [
      `${d.amount > 0 ? "Crédito" : "Débito"} ${formatMoney(Math.abs(d.amount), account.currency)}`,
      d.balance === null
        ? null
        : `Saldo ${formatMoney(d.balance, account.currency)}`,
      d.reference ? `Ref. ${d.reference}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    errors,
    warnings,
    key: d.source_hash,
    payload: { ...d },
  };
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

function buildOne(
  kind: ImportKind,
  cells: Cells,
  lookups: ImportLookups,
  state: FileState,
): Built {
  switch (kind) {
    case "clients":
    case "suppliers":
      return buildCounterparty(kind, cells);
    case "employees":
      return buildEmployee(cells);
    case "vehicles":
      return buildVehicle(cells, lookups, state);
    case "historic_payroll":
      return buildHistoricPayroll(cells, lookups);
    case "historic_trips":
      return buildHistoricTrip(cells, lookups, state);
    case "client_tariffs":
      return buildClientTariff(cells, lookups, state);
    case "loans":
      return buildLoan(cells, lookups);
    case "checks":
      return buildCheck(cells, lookups);
    case "opening_balances":
      return buildOpeningBalance(cells, lookups);
    case "bank_statement":
      return buildStatementLine(cells, lookups, state);
  }
}

/** The required columns the mapping leaves out (their keys). A statement
 *  needs the signed amount or at least one of debit and credit. */
export function missingRequired(
  kind: ImportKind,
  mapping: ImportMapping,
): string[] {
  const missing = IMPORT_FIELDS[kind]
    .filter((f) => f.required && mapping[f.key] === undefined)
    .map((f) => f.key);
  if (
    kind === "bank_statement" &&
    mapping.amount === undefined &&
    mapping.debit === undefined &&
    mapping.credit === undefined
  ) {
    missing.push("amount");
  }
  return missing;
}

/** The rows of the file after its header, built. A row with every mapped
 *  column empty (a blank or a subtotal line) is left out. */
export function buildRows(input: {
  kind: ImportKind;
  rows: readonly (readonly string[])[];
  /** Line number of rows[0] in the file. */
  firstLine: number;
  mapping: ImportMapping;
  lookups: ImportLookups;
}): BuiltRow[] {
  const state: FileState = {
    fuelCards: new Map(),
    tripOccurrences: new Map(),
    tariffRanges: new Map(),
    lineOccurrences: new Map(),
  };
  const keys = IMPORT_FIELDS[input.kind]
    .map((f) => f.key)
    .filter((k) => input.mapping[k] !== undefined);
  const out: BuiltRow[] = [];
  input.rows.forEach((row, i) => {
    const cells: Cells = {};
    for (const key of keys) {
      const index = input.mapping[key];
      cells[key] = index === undefined ? "" : (row[index] ?? "").trim();
    }
    if (Object.values(cells).every((v) => v === "")) return;
    const built = buildOne(input.kind, cells, input.lookups, state);
    out.push({
      ...built,
      line: input.firstLine + i,
      status: built.errors.length > 0 ? "invalid" : "ready",
    });
  });
  return out;
}

/** Marks as duplicate a ready row whose key is already loaded or appeared
 *  earlier in the file. With `strict` (money items, kindHasStrictKeys) a key
 *  repeated in the file is an error in every row that has it instead. */
export function markDuplicates(
  rows: readonly BuiltRow[],
  existing: ReadonlySet<string>,
  strict = false,
): BuiltRow[] {
  const seen = new Set<string>();
  const linesByKey = new Map<string, number[]>();
  for (const row of rows) {
    if (row.status !== "ready" || row.key === null) continue;
    linesByKey.set(row.key, [...(linesByKey.get(row.key) ?? []), row.line]);
  }
  return rows.map((row) => {
    if (row.status !== "ready" || row.key === null) return row;
    const key = row.key;
    if (existing.has(key)) {
      return { ...row, status: "duplicate", warnings: ["Ya está cargado."] };
    }
    const lines = linesByKey.get(key) ?? [];
    if (strict && lines.length > 1) {
      const others = lines.filter((l) => l !== row.line).join(", ");
      return {
        ...row,
        status: "invalid",
        errors: [
          `Se repite en el archivo (fila ${others}): dejá una sola fila con el importe total.`,
        ],
        payload: null,
      };
    }
    if (seen.has(key)) {
      return {
        ...row,
        status: "duplicate",
        warnings: ["Repetido en el archivo."],
      };
    }
    seen.add(key);
    return row;
  });
}

export type ImportCounts = Record<ImportRowStatus, number>;

export function countRows(rows: readonly { status: ImportRowStatus }[]) {
  const out: ImportCounts = { ready: 0, duplicate: 0, invalid: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

export function toPreviewRow(row: BuiltRow): ImportPreviewRow {
  return {
    line: row.line,
    status: row.status,
    label: row.label,
    detail: row.detail,
    errors: row.errors,
    warnings: row.warnings,
  };
}
