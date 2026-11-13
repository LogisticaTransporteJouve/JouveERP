// Every audit action as a Spanish sentence the owner can read: «emitió la
// Factura A 0003-00022312 a TRANSPORTES SUR SA por $ 1.234.567,00». Each
// entry says which «Qué» group the action belongs to, what record its
// target_resource_id is (resolved by name on the server) and how to say it
// from the payload. registry.test.ts fails when a logAudit call names an
// action this file does not know.

import { toolLabel } from "@/features/ai/lib/tool-labels";
import { activityFilters } from "@/features/ai/lib/activity-filters";
import { ATTENDANCE_KIND_LABEL } from "@/features/hr/attendance-schema";
import {
  CREDITOR_LABEL,
  PLAN_STATUS_LABEL,
} from "@/features/hr/account-schema";
import { GARNISHMENT_MODE_LABEL } from "@/features/hr/payroll-schema";
import { LEAVE_KIND_LABEL } from "@/features/hr/vacation-schema";
import { EMPLOYEE_DOCUMENT_KIND_LABEL } from "@/features/employee-documents/schema";
import { FLEET_DOC_KIND_LABELS } from "@/features/fleet-documents/schema";
import { IMPORT_KIND_LABELS } from "@/features/imports/schema";
import { LOAN_KIND_LABEL } from "@/features/loans/schema";
import { SHIPMENT_STATUS_LABELS } from "@/features/shipments/schema";
import { TAX_KIND_LABEL, TAX_STATUS_LABEL } from "@/features/taxes/schema";
import type { JsonValue } from "@/lib/actions/audit";

import type { AuditEntity, EntityKind } from "./entities";
import {
  count,
  joinAnd,
  money,
  percent,
  shortDate,
  shortPeriod,
} from "./words";

// ---------------------------------------------------------------------------
// «Qué»: the groups of the filter, in the order the combobox lists them.
// ---------------------------------------------------------------------------

export const AUDIT_GROUPS = [
  { id: "invoices", label: "Facturas y notas" },
  { id: "receipts", label: "Recibos" },
  { id: "payment_orders", label: "Órdenes de pago" },
  { id: "purchases", label: "Compras" },
  { id: "trips", label: "Viajes y cargas" },
  { id: "settlements", label: "Liquidaciones y rendiciones" },
  { id: "clients", label: "Clientes" },
  { id: "suppliers", label: "Proveedores" },
  { id: "treasury", label: "Caja, bancos y cheques" },
  { id: "taxes", label: "Impuestos" },
  { id: "accounting", label: "Contabilidad" },
  { id: "hr", label: "Empleados y sueldos" },
  { id: "fleet", label: "Flota" },
  { id: "storage", label: "Depósito y pallets" },
  { id: "tasks", label: "Tareas" },
  { id: "files", label: "Archivos e importaciones" },
  { id: "users", label: "Usuarios y permisos" },
  { id: "ai", label: "Asistente IA" },
  { id: "settings", label: "Configuración" },
  { id: "exports", label: "Exportaciones y copias" },
] as const;

export type AuditGroupId = (typeof AUDIT_GROUPS)[number]["id"];

export function isAuditGroupId(value: unknown): value is AuditGroupId {
  return AUDIT_GROUPS.some((g) => g.id === value);
}

// ---------------------------------------------------------------------------
// What a template gets.
// ---------------------------------------------------------------------------

type Payload = { [k: string]: JsonValue | undefined };

export type SentenceInput = {
  /** The event's payload, already masked. */
  p: Payload;
  /** The record target_resource_id names, when it still exists. */
  subject: AuditEntity | null;
  /** A record named in the payload or the target user, when it exists. */
  ref: (kind: EntityKind, id: JsonValue | undefined) => AuditEntity | null;
  /** The user the event is about (target_user_id), by name. */
  targetUser: string | null;
};

type Spec = {
  group: AuditGroupId;
  /** What target_resource_id is, so the server names and links it. */
  subject?: EntityKind;
  say: (c: SentenceInput) => string;
};

// ---------------------------------------------------------------------------
// Helpers the templates share.
// ---------------------------------------------------------------------------

function str(v: JsonValue | undefined): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: JsonValue | undefined): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function quoted(v: JsonValue | undefined): string {
  const s = str(v);
  return s ? ` «${s}»` : "";
}

function label(map: Record<string, string>, v: JsonValue | undefined): string {
  const s = str(v);
  return s ? (map[s] ?? s.replaceAll("_", " ")) : "";
}

/** The subject's own words, or a generic noun when it no longer exists. */
function subj(c: SentenceInput, fallback: string): string {
  return c.subject?.label ?? fallback;
}

/** «la Factura A 0003-… a CLIENTE por $ X»: a document with its party. */
function doc(
  c: SentenceInput,
  fallback: string,
  prep: "a" | "de",
  opts: { amount?: string | null; party?: string | null } = {},
): string {
  const party = opts.party ?? c.subject?.party ?? null;
  const amount = opts.amount ?? c.subject?.amount ?? null;
  return (
    subj(c, fallback) +
    (party ? ` ${prep} ${party}` : "") +
    (amount ? ` por ${amount}` : "")
  );
}

function named(
  c: SentenceInput,
  kind: EntityKind,
  key: string,
  fallback: string,
): string {
  return c.ref(kind, c.p[key])?.label ?? fallback;
}

function party(c: SentenceInput, kind: EntityKind, key: string): string | null {
  return c.ref(kind, c.p[key])?.label ?? null;
}

function withParty(prep: string, name: string | null): string {
  return name ? ` ${prep} ${name}` : "";
}

/** «del 01/11 al 06/11», «del 01/11». */
function range(from: JsonValue | undefined, to: JsonValue | undefined): string {
  const a = str(from);
  const b = str(to);
  if (a && b)
    return a === b
      ? ` del ${shortDate(a)}`
      : ` del ${shortDate(a)} al ${shortDate(b)}`;
  if (a) return ` desde el ${shortDate(a)}`;
  if (b) return ` hasta el ${shortDate(b)}`;
  return "";
}

const FIELD_LABELS: Record<string, string> = {
  name: "nombre",
  legal_name: "razón social",
  display_name: "nombre de fantasía",
  full_name: "nombre",
  cuit: "CUIT",
  cuil: "CUIL",
  email: "email",
  phone: "teléfono",
  address: "domicilio",
  real_address: "domicilio real",
  iva_condition: "condición de IVA",
  notes: "notas",
  description: "descripción",
  is_active: "estado",
  is_fiscal: "condición fiscal",
  patente: "patente",
  alias: "alias",
  brand: "marca",
  model: "modelo",
  year: "año",
  vehicle_type: "tipo",
  capacity_kg: "capacidad",
  fleet: "flota",
  fuel_card: "tarjeta de combustible",
  trip_date: "fecha",
  vehicle_id: "camión",
  driver_id: "chofer",
  origin: "origen",
  destination: "destino",
  km: "km",
  revenue: "ingreso",
  cost: "costo",
  cargo_description: "carga",
  status: "estado",
  amount: "importe",
  liters: "litros",
  load_date: "fecha",
  station: "estación",
  odometer_km: "odómetro",
  service_date: "fecha",
  next_service_date: "próximo service",
  next_service_km: "km del próximo service",
  provider: "proveedor",
  due_date: "vencimiento",
  expires_at: "vencimiento",
  issued_at: "emisión",
  number: "número",
  kind: "tipo",
  fecha: "fecha",
  numero: "número",
  punto_venta: "punto de venta",
  imp_total: "total",
  imp_neto: "neto",
  imp_iva: "IVA",
  supplier_id: "proveedor",
  client_id: "cliente",
  account_id: "cuenta",
  cost_center_id: "centro de costo",
  channel_id: "canal",
  category: "categoría",
  category_id: "categoría",
  frequency: "frecuencia",
  next_due_date: "próximo vencimiento",
  end_date: "fecha de fin",
  base_salary: "sueldo",
  position: "puesto",
  categoria: "categoría",
  convenio: "convenio",
  obra_social: "obra social",
  art: "ART",
  cbu: "CBU",
  hire_date: "fecha de ingreso",
  pay_frequency: "frecuencia de pago",
  pay_mode: "modalidad",
  retribucion_formal: "retribución formal",
  viatico_monthly: "viático",
  license_category: "categoría de licencia",
  license_number: "licencia",
  employee_id: "empleado",
  user_id: "usuario",
  code: "código",
  sku: "SKU",
  unit: "unidad",
  rate_per_pallet: "tarifa por pallet",
  period: "período",
  capacity_pallets: "capacidad",
  warehouse_id: "depósito",
  area_id: "área",
  product_id: "producto",
  quantity: "cantidad",
  lot_number: "lote",
  lot_expiry: "vencimiento del lote",
  remito_number: "remito",
  scheduled_date: "fecha de carga",
  unload_date: "fecha de descarga",
  time_window: "horario",
  delivery_date: "fecha de entrega",
  freight_amount: "flete",
  cod_amount: "contrareembolso",
  trip_id: "viaje",
  check_number: "número de cheque",
  bank_name: "banco",
  beneficiary_name: "beneficiario",
  issue_date: "fecha de emisión",
  fch_vto_pago: "vencimiento de pago",
  title: "título",
  day_of_month: "día del mes",
  default_expense_account_id: "cuenta de gasto",
  default_cost_center_id: "centro de costo",
  default_payment_term_days: "plazo de pago",
  default_channel_id: "canal",
};

/** « (razón social, CUIT y otros datos)» from a payload's `fields` list. */
function fieldsOf(c: SentenceInput): string {
  const fields = c.p.fields;
  if (!Array.isArray(fields)) return "";
  const keys = fields.filter((f): f is string => typeof f === "string");
  const known = [
    ...new Set(keys.flatMap((k) => (FIELD_LABELS[k] ? [FIELD_LABELS[k]] : []))),
  ];
  if (known.length === 0) return "";
  const shown = known.slice(0, 3);
  const more =
    known.length > shown.length || keys.some((k) => !FIELD_LABELS[k]);
  return ` (${shown.join(", ")}${more ? " y otros datos" : ""})`;
}

/** « texto» or "" when there is no text. */
function sp(text: string): string {
  return text ? ` ${text}` : "";
}

/** « (porcentaje: 20)»: an embargo's mode and value. */
function garnishment(c: SentenceInput): string {
  const mode = label(GARNISHMENT_MODE_LABEL, c.p.mode).toLowerCase();
  const value = str(c.p.value);
  return changes([[mode, value].filter(Boolean).join(": ")]);
}

/** « (a y b)» from the parts that apply; "" when none does. */
function changes(parts: (string | false | null)[]): string {
  const kept = parts.filter(
    (p): p is string => typeof p === "string" && p !== "",
  );
  return kept.length > 0 ? ` (${joinAnd(kept)})` : "";
}

function users(c: SentenceInput, key: string): string {
  const list = c.p[key];
  if (!Array.isArray(list)) return "";
  return joinAnd(list.map((id) => c.ref("user", id)?.label ?? "un usuario"));
}

const ROLE_LABELS: Record<string, string> = {
  owner: "dueño",
  admin: "administrador",
  finance: "finanzas",
  fiscal_reader: "contador (solo lectura)",
  operations: "operaciones",
  warehouse: "depósito",
  hr: "RRHH",
  driver: "chofer",
};

function roles(v: JsonValue | undefined): string {
  if (!Array.isArray(v)) return "";
  return joinAnd(v.map((r) => label(ROLE_LABELS, r)).filter(Boolean));
}

function proposal(c: SentenceInput): string {
  const a = str(c.p.action);
  const l = a ? toolLabel(a) : "datos";
  if (l === "datos") return "una propuesta del asistente";
  return l.startsWith("Propuesta de ")
    ? `la propuesta de ${l.slice("Propuesta de ".length)}`
    : `la propuesta «${l}»`;
}

/** «IVA Ventas (09/2026)»: an assistant query by its human label. */
export function aiQueryLabel(input: Payload): string {
  const tool = str(input.tool);
  const what = tool ? toolLabel(tool) : "datos";
  const filters = activityFilters(input.input);
  return filters.length > 0 ? `${what} (${filters.join(" · ")})` : what;
}

const INVOICE_KIND_NOUN: Record<string, string> = {
  factura: "la factura",
  nc: "la nota de crédito",
  nd: "la nota de débito",
};

const TRANSACTION_KIND: Record<string, string> = {
  income: "un ingreso",
  expense: "un egreso",
};

const ACCOUNT_TYPE: Record<string, string> = {
  bank: "bancaria",
  cash: "de caja",
};

const CHECK_KIND: Record<string, string> = {
  physical: "físico",
  echeq: "electrónico",
};

const ISSUED_CHECK_STATUS: Record<string, string> = {
  cashed: "cobrado",
  rejected: "rechazado",
  cancelled: "anulado",
};

const ALLOCATION_MODE: Record<string, string> = {
  fifo: "a los más viejos primero",
  manual: "a mano",
  rejected_checks: "a cheques rechazados",
};

const REVENUE_KIND: Record<string, string> = {
  freight: "flete",
  storage: "almacenaje",
  other: "otros",
};

const INSIGHT_STATUS: Record<string, string> = {
  acknowledged: "marcó como visto",
  dismissed: "descartó",
};

// ---------------------------------------------------------------------------
// The registry.
// ---------------------------------------------------------------------------

const AUDIT_ACTIONS: Record<string, Spec> = {
  // --- Facturas y notas ----------------------------------------------------
  "invoice.issue_requested": {
    group: "invoices",
    subject: "invoice",
    say: (c) =>
      `emitió ${doc(
        c,
        INVOICE_KIND_NOUN[str(c.p.kind) ?? ""] ?? "un comprobante",
        "a",
        {
          party: c.subject?.party ?? party(c, "client", "client_id"),
          amount: c.subject?.amount ?? money(c.p.imp_total),
        },
      )}`,
  },
  "invoice.cancelled": {
    group: "invoices",
    subject: "invoice",
    say: (c) => `anuló ${doc(c, "un comprobante", "a")}`,
  },
  "invoice.remito_credit_retried": {
    group: "invoices",
    subject: "invoice",
    say: (c) =>
      `reintentó la nota de crédito del remito de ${doc(c, "un comprobante", "a")}`,
  },
  "invoice.operational_set": {
    group: "invoices",
    subject: "invoice",
    say: (c) =>
      `marcó ${doc(c, "un comprobante", "a")} como ${c.p.is_operational === false ? "no correspondiente" : "correspondiente"} a la actividad de Jouve`,
  },
  "invoice_item.revenue_kind_set": {
    group: "invoices",
    say: (c) =>
      `cambió el tipo de ingreso de un ítem de ${named(c, "invoice", "invoice_id", "un comprobante")} de ${label(REVENUE_KIND, c.p.from) || "sin tipo"} a ${label(REVENUE_KIND, c.p.to) || "sin tipo"}`,
  },
  "late_interest.nd_issued": {
    group: "invoices",
    say: (c) =>
      `emitió ${named(c, "invoice", "nd_invoice_id", "una nota de débito")} por intereses por mora de ${named(c, "invoice", "invoice_id", "un comprobante")}${money(c.p.interest) ? ` (${money(c.p.interest)}, ${str(c.p.days) ?? "?"} días al ${percent(c.p.monthly_rate)} mensual)` : ""}`,
  },
  "late_interest.bulk_issued": {
    group: "invoices",
    say: (c) =>
      `emitió ${count(num(c.p.issued), "nota de débito", "notas de débito")} por intereses por mora al ${shortDate(c.p.as_of)} (de ${num(c.p.requested) ?? 0} pedidas)`,
  },
  "late_interest.general_rate_set": {
    group: "settings",
    say: (c) =>
      `cambió la tasa general de intereses por mora a ${percent(c.p.monthly_rate)} mensual`,
  },
  "late_interest.client_rate_set": {
    group: "clients",
    subject: "client",
    say: (c) =>
      c.p.monthly_rate === null
        ? `le quitó la tasa propia de intereses por mora a ${subj(c, "un cliente")}`
        : `le puso a ${subj(c, "un cliente")} una tasa de intereses por mora de ${percent(c.p.monthly_rate)} mensual`,
  },
  "storage.invoiced": {
    group: "invoices",
    subject: "invoice",
    say: (c) =>
      `facturó el almacenaje${range(c.p.period_start, c.p.period_end)} con ${doc(
        c,
        "un comprobante",
        "a",
        {
          party: c.subject?.party ?? party(c, "client", "client_id"),
          amount: c.subject?.amount ?? money(c.p.total),
        },
      )}`,
  },
  "shipment.freight_invoiced": {
    group: "invoices",
    subject: "shipment",
    say: (c) =>
      `facturó el flete de ${subj(c, "una carga")} con ${named(c, "invoice", "invoice_id", "un comprobante")}`,
  },
  "shipment.invoice_unlinked": {
    group: "invoices",
    subject: "shipment",
    say: (c) =>
      `liberó ${subj(c, "una carga")} de ${named(c, "invoice", "invoice_id", "su comprobante")} porque el comprobante se anuló`,
  },
  "freight_settlement.invoiced": {
    group: "invoices",
    subject: "freight_settlement",
    say: (c) =>
      `facturó ${doc(c, "una liquidación de flete", "de")} con ${named(c, "invoice", "invoice_id", "un comprobante")}`,
  },

  // --- Recibos -------------------------------------------------------------
  "receipt.created": {
    group: "receipts",
    subject: "receipt",
    say: (c) =>
      `registró ${doc(c, "un recibo", "de", {
        party: c.subject?.party ?? party(c, "client", "client_id"),
        amount: c.subject?.amount ?? money(c.p.total_amount),
      })}`,
  },
  "receipt.updated": {
    group: "receipts",
    subject: "receipt",
    say: (c) =>
      `editó ${doc(c, "un recibo", "de", { amount: money(c.p.total_amount) })}`,
  },
  "receipt.canceled": {
    group: "receipts",
    subject: "receipt",
    say: (c) => `anuló ${doc(c, "un recibo", "de")}`,
  },
  "receipt.allocated": {
    group: "receipts",
    subject: "receipt",
    say: (c) =>
      `imputó ${subj(c, "un recibo")}${withParty("de", c.subject?.party ?? null)} a ${count(num(c.p.documents), "comprobante", "comprobantes")}${c.p.mode ? ` (${label(ALLOCATION_MODE, c.p.mode)})` : ""}`,
  },

  // --- Órdenes de pago -----------------------------------------------------
  "payment_order.created": {
    group: "payment_orders",
    subject: "payment_order",
    say: (c) =>
      `registró ${doc(c, "una orden de pago", "a", {
        party: c.subject?.party ?? party(c, "supplier", "supplier_id"),
        amount: c.subject?.amount ?? money(c.p.total_amount),
      })}`,
  },
  "payment_order.updated": {
    group: "payment_orders",
    subject: "payment_order",
    say: (c) =>
      `editó ${doc(c, "una orden de pago", "a", { amount: money(c.p.total_amount) })}`,
  },
  "payment_order.canceled": {
    group: "payment_orders",
    subject: "payment_order",
    say: (c) => `anuló ${doc(c, "una orden de pago", "a")}`,
  },
  "payment_order.allocated": {
    group: "payment_orders",
    subject: "payment_order",
    say: (c) =>
      `imputó ${subj(c, "una orden de pago")}${withParty("a", c.subject?.party ?? null)} a ${count(num(c.p.documents), "comprobante", "comprobantes")}${c.p.mode ? ` (${label(ALLOCATION_MODE, c.p.mode)})` : ""}`,
  },

  // --- Compras -------------------------------------------------------------
  "purchase_invoice.created": {
    group: "purchases",
    subject: "purchase_invoice",
    say: (c) =>
      `cargó ${doc(c, "una factura de compra", "de", {
        party: c.subject?.party ?? party(c, "supplier", "supplier_id"),
        amount: c.subject?.amount ?? money(c.p.imp_total),
      })}`,
  },
  "purchase_invoice.updated": {
    group: "purchases",
    subject: "purchase_invoice",
    say: (c) => `editó ${doc(c, "una factura de compra", "de")}${fieldsOf(c)}`,
  },
  "purchase_invoice.cancelled": {
    group: "purchases",
    subject: "purchase_invoice",
    say: (c) => `anuló ${doc(c, "una factura de compra", "de")}`,
  },
  "purchase_invoice.remitos_imputed": {
    group: "purchases",
    subject: "purchase_invoice",
    say: (c) =>
      `imputó ${count(Array.isArray(c.p.remito_ids) ? c.p.remito_ids.length : 0, "remito", "remitos")} a ${doc(c, "una factura de compra", "de")}`,
  },
  "purchase_invoice.arca_voucher_confirmed": {
    group: "purchases",
    subject: "purchase_invoice",
    say: (c) =>
      c.p.linkedExisting === true
        ? `vinculó un comprobante recibido en ARCA con ${doc(c, "una factura de compra", "de")}`
        : `aceptó un comprobante recibido en ARCA como ${doc(c, "una factura de compra", "de")}`,
  },
  "purchase_invoice.arca_voucher_discarded": {
    group: "purchases",
    say: () => "descartó un comprobante recibido en ARCA",
  },
  "purchase_invoice.arca_voucher_restored": {
    group: "purchases",
    say: () => "volvió a la bandeja un comprobante recibido en ARCA",
  },
  "purchase_invoice.arca_file_uploaded": {
    group: "purchases",
    say: (c) =>
      `subió el archivo de comprobantes recibidos de ARCA (${count(num(c.p.inserted), "nuevo", "nuevos")}, ${num(c.p.alreadyInTray) ?? 0} ya estaban)`,
  },
  "purchase_invoice.arca_sync_requested": {
    group: "purchases",
    say: (c) =>
      `pidió traer de ARCA los comprobantes recibidos${range(c.p.from, c.p.to)}`,
  },
  "purchase_invoice.arca_bulk_accept_requested": {
    group: "purchases",
    say: () => "pidió aceptar en bloque los comprobantes recibidos de ARCA",
  },
  "expense.recategorized": {
    group: "purchases",
    say: (c) =>
      `cambió la cuenta de gasto${c.p.expense_account_id ? ` a ${named(c, "account", "expense_account_id", "otra cuenta")}` : ""} de un ${str(c.p.source) === "transaction" ? "movimiento de caja" : "gasto"}`,
  },

  // --- Viajes y cargas -----------------------------------------------------
  "trip.created": {
    group: "trips",
    subject: "trip",
    say: (c) =>
      `programó ${subj(c, `un viaje${c.p.trip_date ? ` del ${shortDate(c.p.trip_date)}` : ""}`)}`,
  },
  ...prefixed("trip", {
    updated: {
      group: "trips",
      subject: "trip",
      say: (c) => `editó ${subj(c, "un viaje")}${fieldsOf(c)}`,
    },
    deleted: {
      group: "trips",
      subject: "trip",
      say: (c) => `borró ${subj(c, "un viaje")}`,
    },
  }),
  "shipment.created": {
    group: "trips",
    subject: "shipment",
    say: (c) =>
      `cargó ${subj(c, "una carga")}${withParty("de", c.subject?.party ?? null)}`,
  },
  "shipment.updated": {
    group: "trips",
    subject: "shipment",
    say: (c) => `editó ${subj(c, "una carga")}${fieldsOf(c)}`,
  },
  "shipment.deleted": {
    group: "trips",
    subject: "shipment",
    say: (c) => `borró ${subj(c, "una carga")}`,
  },
  "shipment.status_changed": {
    group: "trips",
    subject: "shipment",
    say: (c) =>
      `pasó ${subj(c, "una carga")} de «${label(SHIPMENT_STATUS_LABELS, c.p.from)}» a «${label(SHIPMENT_STATUS_LABELS, c.p.to)}»`,
  },
  "shipment.trip_set": {
    group: "trips",
    subject: "shipment",
    say: (c) =>
      c.p.trip_id
        ? `asignó ${subj(c, "una carga")} a ${named(c, "trip", "trip_id", "un viaje")}`
        : `sacó ${subj(c, "una carga")} de su viaje`,
  },

  // --- Liquidaciones y rendiciones -----------------------------------------
  "freight_settlement.created": {
    group: "settlements",
    subject: "freight_settlement",
    say: (c) =>
      `armó ${doc(c, "una liquidación de flete", "de", { party: c.subject?.party ?? party(c, "client", "client_id") })} con ${count(num(c.p.shipments), "carga", "cargas")}`,
  },
  "freight_settlement.updated": {
    group: "settlements",
    subject: "freight_settlement",
    say: (c) =>
      `editó ${doc(c, "una liquidación de flete", "de")} (${count(num(c.p.shipments), "carga", "cargas")})`,
  },
  "freight_settlement.bulk_created": {
    group: "settlements",
    say: (c) =>
      `armó ${count(num(c.p.created), "liquidación de flete", "liquidaciones de flete")}${range(c.p.period_start, c.p.period_end)}${c.p.confirm === true ? " y las confirmó" : ""}`,
  },
  "freight_settlement.confirmed": {
    group: "settlements",
    subject: "freight_settlement",
    say: (c) =>
      `confirmó ${doc(c, "una liquidación de flete", "de")}${c.p.numero ? ` (remito N° ${str(c.p.numero)})` : ""}`,
  },
  "freight_settlement.cancelled": {
    group: "settlements",
    subject: "freight_settlement",
    say: (c) => `anuló ${doc(c, "una liquidación de flete", "de")}`,
  },
  "freight_settlement.emailed": {
    group: "settlements",
    subject: "freight_settlement",
    say: (c) => `mandó por email ${doc(c, "una liquidación de flete", "a")}`,
  },
  "driver_settlement.created": {
    group: "settlements",
    subject: "driver_settlement",
    say: (c) =>
      `cargó ${subj(c, `una rendición${c.p.settlement_date ? ` del ${shortDate(c.p.settlement_date)}` : ""}`)} de ${c.subject?.party ?? named(c, "driver", "driver_id", "un chofer")} con ${count(num(c.p.cargas), "carga", "cargas")}`,
  },
  "driver_settlement.updated": {
    group: "settlements",
    subject: "driver_settlement",
    say: (c) =>
      `editó ${subj(c, "una rendición")} de ${c.subject?.party ?? named(c, "driver", "driver_id", "un chofer")}`,
  },
  "driver_settlement.confirmed": {
    group: "settlements",
    subject: "driver_settlement",
    say: (c) =>
      `confirmó ${subj(c, "una rendición")}${withParty("de", c.subject?.party ?? null)}${Array.isArray(c.p.receipt_ids) && c.p.receipt_ids.length > 0 ? ` y generó ${count(c.p.receipt_ids.length, "recibo", "recibos")}` : ""}`,
  },
  "driver_settlement.cancelled": {
    group: "settlements",
    subject: "driver_settlement",
    say: (c) =>
      `anuló ${subj(c, "una rendición")}${withParty("de", c.subject?.party ?? null)}`,
  },
  "driver_settlement.difference_posted": {
    group: "settlements",
    subject: "driver_settlement",
    say: (c) =>
      `imputó la diferencia de ${subj(c, "una rendición")}${withParty("de", c.subject?.party ?? null)}`,
  },
  "driver_settlement.difference_unposted": {
    group: "settlements",
    subject: "driver_settlement",
    say: (c) =>
      `deshizo la diferencia imputada de ${subj(c, "una rendición")}${withParty("de", c.subject?.party ?? null)}`,
  },

  // --- Clientes ------------------------------------------------------------
  "client.created": {
    group: "clients",
    subject: "client",
    say: (c) =>
      `dio de alta al cliente ${subj(c, str(c.p.legal_name) ?? "nuevo")}`,
  },
  "client.updated": {
    group: "clients",
    subject: "client",
    say: (c) => `editó el cliente ${subj(c, "(ya borrado)")}${fieldsOf(c)}`,
  },
  "client.deleted": {
    group: "clients",
    subject: "client",
    say: (c) => `borró el cliente ${subj(c, "(ya borrado)")}`,
  },
  "client.deactivated": {
    group: "clients",
    subject: "client",
    say: (c) => `desactivó el cliente ${subj(c, "(ya borrado)")}`,
  },
  "client.reactivated": {
    group: "clients",
    subject: "client",
    say: (c) => `reactivó el cliente ${subj(c, "(ya borrado)")}`,
  },
  "client.opening_balance.applied": {
    group: "clients",
    subject: "client",
    say: (c) =>
      `ajustó el saldo inicial de ${subj(c, "un cliente")} a ${money(c.p.target_balance) ?? "—"}${c.p.target_balance_usd != null ? ` y ${money(c.p.target_balance_usd, "USD")}` : ""} al ${shortDate(c.p.opening_date)}`,
  },
  "client.opening_balance.cleared": {
    group: "clients",
    subject: "client",
    say: (c) => `borró el saldo inicial de ${subj(c, "un cliente")}`,
  },
  "client_tariff.created": {
    group: "clients",
    say: (c) =>
      `cargó la tarifa${quoted(c.p.concept)} de ${named(c, "client", "client_id", "un cliente")} a ${money(c.p.price, c.p.currency) ?? "—"}${range(c.p.valid_from, c.p.valid_to)}`,
  },
  "client_tariff.updated": {
    group: "clients",
    say: (c) =>
      `editó la tarifa${quoted(c.p.concept)}: ${money(c.p.price, c.p.currency) ?? "—"}${range(c.p.valid_from, c.p.valid_to)}`,
  },
  "client_tariff.deleted": {
    group: "clients",
    say: (c) =>
      `borró la tarifa${quoted(c.p.concept)} de ${named(c, "client", "client_id", "un cliente")}`,
  },

  // --- Proveedores ---------------------------------------------------------
  "supplier.created": {
    group: "suppliers",
    subject: "supplier",
    say: (c) =>
      `dio de alta al proveedor ${subj(c, str(c.p.legal_name) ?? "nuevo")}`,
  },
  "supplier.updated": {
    group: "suppliers",
    subject: "supplier",
    say: (c) => `editó el proveedor ${subj(c, "(ya borrado)")}${fieldsOf(c)}`,
  },
  "supplier.deleted": {
    group: "suppliers",
    subject: "supplier",
    say: (c) => `borró el proveedor ${subj(c, "(ya borrado)")}`,
  },
  "supplier.deactivated": {
    group: "suppliers",
    subject: "supplier",
    say: (c) => `desactivó el proveedor ${subj(c, "(ya borrado)")}`,
  },
  "supplier.reactivated": {
    group: "suppliers",
    subject: "supplier",
    say: (c) => `reactivó el proveedor ${subj(c, "(ya borrado)")}`,
  },
  "supplier.opening_balance.applied": {
    group: "suppliers",
    subject: "supplier",
    say: (c) =>
      `ajustó el saldo inicial de ${subj(c, "un proveedor")} a ${money(c.p.target_balance) ?? "—"}${c.p.target_balance_usd != null ? ` y ${money(c.p.target_balance_usd, "USD")}` : ""} al ${shortDate(c.p.opening_date)}${str(c.p.source) === "arca_bulk_accept" ? " (al aceptar en bloque de ARCA)" : ""}`,
  },
  "supplier.opening_balance.cleared": {
    group: "suppliers",
    subject: "supplier",
    say: (c) => `borró el saldo inicial de ${subj(c, "un proveedor")}`,
  },
  "supplier_category.created": {
    group: "suppliers",
    say: (c) => `creó la categoría de proveedores${quoted(c.p.name)}`,
  },
  "supplier_category.updated": {
    group: "suppliers",
    say: () => "editó una categoría de proveedores",
  },
  "supplier_category.deleted": {
    group: "suppliers",
    say: () => "borró una categoría de proveedores",
  },

  // --- Caja, bancos y cheques ----------------------------------------------
  "account.created": {
    group: "treasury",
    subject: "account",
    say: (c) =>
      `creó la cuenta${c.p.type ? ` ${label(ACCOUNT_TYPE, c.p.type)}` : ""}${quoted(c.p.name)}`,
  },
  "account.updated": {
    group: "treasury",
    subject: "account",
    say: (c) => `editó la cuenta ${subj(c, "(ya borrada)")}${fieldsOf(c)}`,
  },
  "account.deactivated": {
    group: "treasury",
    subject: "account",
    say: (c) => `desactivó la cuenta ${subj(c, "(ya borrada)")}`,
  },
  "account.reactivated": {
    group: "treasury",
    subject: "account",
    say: (c) => `reactivó la cuenta ${subj(c, "(ya borrada)")}`,
  },
  "account.opening_balance.applied": {
    group: "treasury",
    subject: "account",
    say: (c) =>
      `ajustó el saldo de la cuenta ${subj(c, "(ya borrada)")} a ${money(c.p.target_balance) ?? "—"} al ${shortDate(c.p.adjustment_date)}`,
  },
  "account.opening_balance.cleared": {
    group: "treasury",
    subject: "account",
    say: (c) =>
      `borró el ajuste de saldo de la cuenta ${subj(c, "(ya borrada)")}`,
  },
  "transaction.created": {
    group: "treasury",
    say: (c) =>
      `registró ${label(TRANSACTION_KIND, c.p.kind) || "un movimiento"} de ${money(c.p.amount) ?? "—"} en ${named(c, "account", "account_id", "una cuenta")}${c.p.bank_statement_line_id ? " desde la conciliación bancaria" : ""}`,
  },
  "transaction.updated": {
    group: "treasury",
    say: (c) => `editó un movimiento de caja (${money(c.p.amount) ?? "—"})`,
  },
  "transaction.deleted": {
    group: "treasury",
    say: () => "borró un movimiento de caja",
  },
  "transaction.transfer_created": {
    group: "treasury",
    say: (c) =>
      `transfirió ${money(c.p.amount) ?? "—"} de ${named(c, "account", "from", "una cuenta")} a ${named(c, "account", "to", "otra cuenta")}`,
  },
  "bank_statement_line.matched": {
    group: "treasury",
    say: (c) =>
      `concilió una línea del extracto bancario${c.p.created === true ? " creando el movimiento" : ""}${c.p.suggested === true ? " (sugerencia aceptada)" : ""}`,
  },
  "bank_statement_line.unmatched": {
    group: "treasury",
    say: () => "desconcilió una línea del extracto bancario",
  },
  "bank_statement_line.ignored": {
    group: "treasury",
    say: (c) => `ignoró una línea del extracto bancario${quoted(c.p.reason)}`,
  },
  "bank_statement_code.saved": {
    group: "treasury",
    say: (c) =>
      `configuró el código ${str(c.p.bank_code) ?? ""} del extracto bancario`.replace(
        "  ",
        " ",
      ),
  },
  "bank_statement_code.deleted": {
    group: "treasury",
    say: (c) =>
      `borró el código ${str(c.p.bank_code) ?? ""} del extracto bancario`.replace(
        "  ",
        " ",
      ),
  },
  "card_statement.created": {
    group: "treasury",
    say: (c) => `cargó el resumen de tarjeta ${str(c.p.number) ?? ""}`.trim(),
  },
  "card_statement.deleted": {
    group: "treasury",
    say: (c) => `borró el resumen de tarjeta ${str(c.p.number) ?? ""}`.trim(),
  },
  "card_statement.lines_updated": {
    group: "treasury",
    say: () => "cambió qué son consumos de un resumen de tarjeta",
  },
  "card_statement.unsettled": {
    group: "treasury",
    say: (c) =>
      `deshizo el pago de ${c.p.currency === "USD" ? "los dólares" : "los pesos"} de un resumen de tarjeta`,
  },
  "card_holder.updated": {
    group: "treasury",
    say: (c) =>
      `cambió el destino de los consumos de la tarjeta ${str(c.p.last4) ?? ""}`.trim(),
  },
  "card_statement.paid": {
    group: "treasury",
    say: (c) =>
      `pagó ${c.p.currency === "USD" ? "los dólares" : "los pesos"} de un resumen de tarjeta desde el extracto`,
  },
  "bank_statement_code.preset": {
    group: "treasury",
    say: (c) =>
      `cargó los códigos del banco de la cuenta (${num(c.p.inserted) ?? 0} nuevos)`,
  },
  "bank_statement_line.restored": {
    group: "treasury",
    say: () => "volvió a pendiente una línea del extracto bancario",
  },
  "check.created": {
    group: "treasury",
    subject: "check",
    say: (c) =>
      `cargó el cheque${c.p.kind ? ` ${label(CHECK_KIND, c.p.kind)}` : ""} N° ${str(c.p.check_number) ?? "—"} del ${str(c.p.bank_name) ?? "banco"} por ${money(c.p.amount) ?? "—"}`,
  },
  "check.deposited": {
    group: "treasury",
    subject: "check",
    say: (c) =>
      `depositó ${subj(c, "un cheque")} en ${named(c, "account", "destination_account_id", "una cuenta")}`,
  },
  "check.credited": {
    group: "treasury",
    subject: "check",
    say: (c) => `marcó como acreditado ${subj(c, "un cheque")}`,
  },
  "check.rejected": {
    group: "treasury",
    subject: "check",
    say: (c) => `marcó como rechazado ${subj(c, "un cheque")}`,
  },
  "check.rejection_nd_issued": {
    group: "invoices",
    subject: "check",
    say: (c) =>
      `emitió ${named(c, "invoice", "nd_invoice_id", "una nota de débito")} por los gastos de ${subj(c, "un cheque")} rechazado${money(c.p.amount) ? ` (${money(c.p.amount)} + IVA)` : ""}`,
  },
  "check.rejected_as_sale_debt": {
    group: "treasury",
    subject: "check",
    say: (c) =>
      `registró el rechazo de ${subj(c, "un cheque")} vendido (queda como deuda)`,
  },
  "check_sale.created": {
    group: "treasury",
    say: (c) =>
      `vendió ${count(Array.isArray(c.p.check_ids) ? c.p.check_ids.length : 0, "cheque", "cheques")}${c.p.buyer_name ? ` a ${str(c.p.buyer_name)}` : ""}`,
  },
  "check_sale.cancelled": {
    group: "treasury",
    say: (c) => `anuló una venta de cheques${quoted(c.p.reason)}`,
  },
  "check_sale_debt.paid": {
    group: "treasury",
    say: (c) =>
      `pagó la deuda de un cheque vendido rechazado desde ${named(c, "account", "account_id", "una cuenta")}`,
  },
  "issued_check.created": {
    group: "treasury",
    subject: "issued_check",
    say: (c) =>
      `emitió el cheque propio N° ${str(c.p.check_number) ?? "—"} por ${money(c.p.amount) ?? "—"}${withParty("a", c.subject?.party ?? null)}`,
  },
  "issued_check.updated": {
    group: "treasury",
    subject: "issued_check",
    say: (c) => `editó ${subj(c, "un cheque propio")}${fieldsOf(c)}`,
  },
  ...Object.fromEntries(
    Object.entries(ISSUED_CHECK_STATUS).map(([status, word]) => [
      `issued_check.${status}`,
      {
        group: "treasury",
        subject: "issued_check",
        say: (c: SentenceInput) =>
          `marcó como ${word} ${subj(c, "un cheque propio")}${c.p.event_date ? ` el ${shortDate(c.p.event_date)}` : ""}`,
      } satisfies Spec,
    ]),
  ),
  "loan.created": {
    group: "treasury",
    subject: "loan",
    say: (c) =>
      `cargó ${subj(c, "un préstamo")}${changes([label(LOAN_KIND_LABEL, c.p.kind).toLowerCase()])}`,
  },
  "loan.cancelled": {
    group: "treasury",
    subject: "loan",
    say: (c) => `anuló ${subj(c, "un préstamo")}`,
  },
  "loan.disbursement_recorded": {
    group: "treasury",
    subject: "loan",
    say: (c) =>
      `${c.p.adopted === true ? "vinculó el movimiento de" : "registró"} la acreditación de ${subj(c, "un préstamo")}`,
  },
  "loan.bank_payments_recorded": {
    group: "treasury",
    subject: "loan",
    say: (c) =>
      `cargó ${typeof c.p.inserted === "number" ? c.p.inserted : "los"} comprobantes del banco de ${subj(c, "un préstamo")}`,
  },
  "loan.opening_booked": {
    group: "treasury",
    subject: "loan",
    say: (c) => `registró la deuda de apertura de ${subj(c, "un préstamo")}`,
  },
  "loan.installment_paid": {
    group: "treasury",
    say: (c) => `pagó una cuota de préstamo por ${money(c.p.amount) ?? "—"}`,
  },
  // Written by the I6 data step (docs/pendientes/2026-11-12-prestamo-sin-vencimiento.md).
  "loan.converted_open_ended": {
    group: "treasury",
    subject: "loan",
    say: (c) => `pasó ${subj(c, "un préstamo")} a sin vencimiento`,
  },
  "loan.installment_payment_relinked": {
    group: "treasury",
    say: () =>
      "vinculó el egreso real a una cuota pagada antes de cargar el préstamo",
  },
  "loan.capital_repaid": {
    group: "treasury",
    subject: "loan",
    say: (c) =>
      `registró una devolución de capital de ${subj(c, "un préstamo")}`,
  },
  "loan.installment_payment_adopted": {
    group: "treasury",
    say: () =>
      "vinculó un movimiento de caja como pago de una cuota de préstamo",
  },
  "loan.installment_split_updated": {
    group: "treasury",
    say: () =>
      "cambió el desglose (capital, intereses, impuestos) de una cuota de préstamo",
  },
  "loan.installment_statement_applied": {
    group: "treasury",
    say: (c) =>
      `cargó el resumen de ${typeof c.p.installment_number === "number" ? `la cuota ${c.p.installment_number}` : "una cuota"} de un leasing por ${money(c.p.amount) ?? "—"}`,
  },
  "recurring_payment.created": {
    group: "treasury",
    subject: "recurring_payment",
    say: (c) =>
      `creó el pago recurrente${quoted(c.p.description)} de ${money(c.p.amount) ?? "—"}`,
  },
  ...prefixed("recurring_payment", {
    updated: {
      group: "treasury",
      subject: "recurring_payment",
      say: (c) => `editó ${subj(c, "un pago recurrente")}${fieldsOf(c)}`,
    },
    deleted: {
      group: "treasury",
      subject: "recurring_payment",
      say: (c) => `borró ${subj(c, "un pago recurrente")}`,
    },
    deactivated: {
      group: "treasury",
      subject: "recurring_payment",
      say: (c) => `pausó ${subj(c, "un pago recurrente")}`,
    },
    reactivated: {
      group: "treasury",
      subject: "recurring_payment",
      say: (c) => `reactivó ${subj(c, "un pago recurrente")}`,
    },
  }),

  // --- Impuestos -----------------------------------------------------------
  "tax_document.created": {
    group: "taxes",
    subject: "tax_document",
    say: (c) =>
      `cargó el impuesto${sp(label(TAX_KIND_LABEL, c.p.kind))} de ${shortPeriod(c.p.period)}${c.p.estimate === true ? " (estimado)" : ""}`,
  },
  "tax_document.updated": {
    group: "taxes",
    subject: "tax_document",
    say: (c) =>
      `editó el impuesto${sp(label(TAX_KIND_LABEL, c.p.kind))} de ${shortPeriod(c.p.period)}`,
  },
  "tax_document.status_changed": {
    group: "taxes",
    subject: "tax_document",
    say: (c) =>
      `pasó ${subj(c, "un impuesto")} a «${label(TAX_STATUS_LABEL, c.p.status)}»`,
  },
  "tax_document.paid": {
    group: "taxes",
    subject: "tax_document",
    say: (c) =>
      `pagó ${subj(c, "un impuesto")}${money(c.p.amount) ? ` por ${money(c.p.amount)}` : ""}`,
  },
  "tax_document.payment_linked": {
    group: "taxes",
    subject: "tax_document",
    say: (c) =>
      `vinculó un movimiento de caja como pago de ${subj(c, "un impuesto")}`,
  },
  "tax_document.payment_undone": {
    group: "taxes",
    subject: "tax_document",
    say: (c) => `deshizo el pago de ${subj(c, "un impuesto")}`,
  },
  "tax_document.copied": {
    group: "taxes",
    say: (c) =>
      `copió ${count(num(c.p.created), "impuesto", "impuestos")} de ${shortPeriod(c.p.from)} a ${shortPeriod(c.p.period)}`,
  },
  "libro_iva.txt_exported": {
    group: "exports",
    say: (c) =>
      `exportó el TXT del Libro IVA ${str(c.p.book) === "compras" ? "Compras" : "Ventas"} de ${shortPeriod(c.p.period)} (${count(num(c.p.documents), "comprobante", "comprobantes")})`,
  },

  // --- Contabilidad --------------------------------------------------------
  "journal_entry.manual_created": {
    group: "accounting",
    say: (c) =>
      `cargó un asiento manual${quoted(c.p.description)} del ${shortDate(c.p.entry_date)} por ${money(c.p.total_debit) ?? "—"}`,
  },
  "accounting_settings.updated": {
    group: "settings",
    say: (c) => {
      const change = c.p.fiscal_year_start_month;
      const to =
        typeof change === "object" && change !== null && !Array.isArray(change)
          ? num(change.to)
          : null;
      const month = to !== null ? MONTHS[to - 1] : undefined;
      return month
        ? `cambió el inicio del ejercicio contable a ${month}`
        : "cambió el inicio del ejercicio contable";
    },
  },
  "accounting_period.closed": {
    group: "accounting",
    say: (c) =>
      `cerró el período contable ${shortPeriod(periodOf(c.p.period))}`,
  },
  "accounting_period.reopened": {
    group: "accounting",
    say: (c) =>
      `reabrió el período contable ${shortPeriod(periodOf(c.p.period))}`,
  },
  "chart_account.created": {
    group: "accounting",
    say: () => "creó una cuenta del plan de cuentas",
  },
  "chart_account.updated": {
    group: "accounting",
    say: () => "editó una cuenta del plan de cuentas",
  },
  "chart_account.deleted": {
    group: "accounting",
    say: () => "borró una cuenta del plan de cuentas",
  },
  "cost_center.created": {
    group: "accounting",
    subject: "cost_center",
    say: (c) => `creó el centro de costo${quoted(c.p.name)}`,
  },
  ...prefixed("cost_center", {
    updated: {
      group: "accounting",
      subject: "cost_center",
      say: (c) => `editó ${subj(c, "un centro de costo")}`,
    },
    deleted: {
      group: "accounting",
      subject: "cost_center",
      say: (c) => `borró ${subj(c, "un centro de costo")}`,
    },
  }),
  "exchange_rate.upserted": {
    group: "accounting",
    say: (c) =>
      `cargó la cotización del dólar del ${shortDate(c.p.rate_date)} en ${money(c.p.rate) ?? "—"}`,
  },
  "exchange_rate.deleted": {
    group: "accounting",
    say: () => "borró una cotización del dólar",
  },
  "inflation_adjustment.applied": {
    group: "accounting",
    say: (c) => `aplicó el ajuste por inflación de ${shortPeriod(c.p.period)}`,
  },
  "inflation_adjustment.reverted": {
    group: "accounting",
    say: (c) =>
      `revirtió el ajuste por inflación de ${shortPeriod(c.p.period)}`,
  },
  "management_bucket.set": {
    group: "accounting",
    say: (c) =>
      `movió una cuenta en el resultado de gestión a «${[str(c.p.bucket), str(c.p.subbucket)].filter(Boolean).join(" › ") || "sin rubro"}»`,
  },

  // --- Empleados y sueldos -------------------------------------------------
  "employee.created": {
    group: "hr",
    subject: "employee",
    say: (c) =>
      `dio de alta al empleado ${subj(c, str(c.p.legal_name) ?? "nuevo")}`,
  },
  "employee.updated": {
    group: "hr",
    subject: "employee",
    say: (c) => `editó el legajo de ${subj(c, "un empleado")}${fieldsOf(c)}`,
  },
  "employee.salary_changed": {
    group: "hr",
    subject: "employee",
    say: (c) =>
      `cambió el sueldo de ${subj(c, str(c.p.legal_name) ?? "un empleado")} de ${money(c.p.from) ?? "—"} a ${money(c.p.to) ?? "—"}`,
  },
  "employee.salary_raise_applied": {
    group: "hr",
    say: (c) =>
      `aplicó un aumento de ${percent(c.p.percentage)} a ${count(num(c.p.updated), "empleado", "empleados")} desde ${shortPeriod(c.p.effective_month)}`,
  },
  "employee.terminated": {
    group: "hr",
    subject: "employee",
    say: (c) =>
      `dio de baja a ${subj(c, "un empleado")} el ${shortDate(c.p.termination_date)}`,
  },
  "employee.reactivated": {
    group: "hr",
    subject: "employee",
    say: (c) => `reincorporó a ${subj(c, "un empleado")}`,
  },
  "employee.trip_rates_updated": {
    group: "hr",
    subject: "employee",
    say: (c) => `cambió las tarifas por viaje de ${subj(c, "un empleado")}`,
  },
  "employee.vacation_balance_set": {
    group: "hr",
    subject: "employee",
    say: (c) =>
      `cargó el saldo de vacaciones${c.p.period_year ? ` ${str(c.p.period_year)}` : ""} de ${subj(c, "un empleado")}: ${num(c.p.current_days) ?? 0} días del año y ${num(c.p.previous_days) ?? 0} de años anteriores`,
  },
  "employee.advance_recorded": {
    group: "hr",
    say: (c) =>
      `registró un adelanto de ${money(c.p.amount) ?? "—"} a ${named(c, "employee", "employee_id", "un empleado")}`,
  },
  "employee.account_payment_recorded": {
    group: "hr",
    say: (c) =>
      `registró un pago de ${named(c, "employee", "employee_id", "un empleado")} a su cuenta por ${money(c.p.amount) ?? "—"}`,
  },
  "employee.account_movement_created": {
    group: "hr",
    say: (c) =>
      `cargó un movimiento de ${money(c.p.amount, c.p.currency) ?? "—"} en la cuenta de ${named(c, "employee", "employee_id", "un empleado")}${c.p.creditor ? ` (${label(CREDITOR_LABEL, c.p.creditor).toLowerCase()})` : ""}`,
  },
  "employee.account_movement_updated": {
    group: "hr",
    say: (c) =>
      `editó un movimiento de la cuenta de un empleado${quoted(c.p.description)}`,
  },
  "employee.account_movement_deleted": {
    group: "hr",
    say: () => "borró un movimiento de la cuenta de un empleado",
  },
  "employee.debt_plan_created": {
    group: "hr",
    say: (c) =>
      `armó un plan de deuda de ${money(c.p.total, c.p.currency) ?? "—"} para ${named(c, "employee", "employee_id", "un empleado")} en cuotas de ${money(c.p.installment_amount, c.p.currency) ?? "—"}`,
  },
  "employee.debt_plan_updated": {
    group: "hr",
    say: (c) =>
      `editó un plan de deuda de un empleado (${money(c.p.total) ?? "—"})`,
  },
  "employee.debt_plan_status_changed": {
    group: "hr",
    say: (c) =>
      `pasó un plan de deuda de un empleado a «${label(PLAN_STATUS_LABEL, c.p.status)}»`,
  },
  "employee.debt_plan_deleted": {
    group: "hr",
    say: () => "borró un plan de deuda de un empleado",
  },
  "employee.garnishment_created": {
    group: "hr",
    say: (c) =>
      `cargó un embargo a ${named(c, "employee", "employee_id", "un empleado")}${garnishment(c)} desde el ${shortDate(c.p.active_from)}`,
  },
  "employee.garnishment_updated": {
    group: "hr",
    say: (c) => `editó un embargo${garnishment(c)}`,
  },
  "employee.garnishment_deleted": {
    group: "hr",
    say: () => "borró un embargo",
  },
  "employee_document.created": {
    group: "hr",
    say: (c) =>
      `cargó ${label(EMPLOYEE_DOCUMENT_KIND_LABEL, c.p.kind) || "un documento"} de ${named(c, "employee", "employee_id", "un empleado")}`,
  },
  "employee_document.updated": {
    group: "hr",
    say: () => "editó un documento de un empleado",
  },
  "employee_document.deleted": {
    group: "hr",
    say: () => "borró un documento de un empleado",
  },
  "employee_document.file_removed": {
    group: "hr",
    say: () => "quitó el archivo de un documento de un empleado",
  },
  "attendance.upserted": {
    group: "hr",
    say: (c) =>
      `cargó ${label(ATTENDANCE_KIND_LABEL, c.p.kind).toLowerCase() || "la asistencia"} de ${named(c, "employee", "employee_id", "un empleado")} el ${shortDate(c.p.date)}`,
  },
  "attendance.deleted": {
    group: "hr",
    say: () => "borró un registro de asistencia",
  },
  "leave.created": {
    group: "hr",
    say: (c) =>
      `cargó ${label(LEAVE_KIND_LABEL, c.p.kind).toLowerCase() || "una licencia"} de ${named(c, "employee", "employee_id", "un empleado")}${range(c.p.start_date, c.p.end_date)}`,
  },
  "leave.deleted": { group: "hr", say: () => "borró una licencia" },
  "payroll.period_created": {
    group: "hr",
    say: (c) =>
      `abrió la liquidación de sueldos de ${monthYear(c.p.month, c.p.year)}`,
  },
  "payroll.sac_period_created": {
    group: "hr",
    say: (c) =>
      `abrió la liquidación del aguinaldo del ${num(c.p.half) === 2 ? "segundo" : "primer"} semestre ${str(c.p.year) ?? ""}`.trim(),
  },
  "payroll.entries_added": {
    group: "hr",
    say: (c) =>
      `agregó ${count(num(c.p.added), "empleado", "empleados")} a una liquidación de sueldos`,
  },
  "payroll.period_closed": {
    group: "hr",
    say: () => "cerró una liquidación de sueldos",
  },
  "payroll.period_reopened": {
    group: "hr",
    say: () => "reabrió una liquidación de sueldos",
  },
  "payroll.entry_updated": {
    group: "hr",
    say: () => "editó el recibo de sueldo de un empleado",
  },
  "payroll.entry_deudas_reset": {
    group: "hr",
    say: () => "recalculó las deudas del recibo de sueldo de un empleado",
  },
  "payroll.entry_embargo_reset": {
    group: "hr",
    say: () => "recalculó el embargo del recibo de sueldo de un empleado",
  },
  "payroll.extra_added": {
    group: "hr",
    say: (c) =>
      `agregó un extra${quoted(c.p.description)} de ${money(c.p.amount) ?? "—"} a un recibo de sueldo`,
  },
  "payroll.extra_removed": {
    group: "hr",
    say: () => "quitó un extra de un recibo de sueldo",
  },
  "payroll.final_settlement_applied": {
    group: "hr",
    say: (c) =>
      `liquidó la liquidación final de ${named(c, "employee", "employee_id", "un empleado")} (${monthYear(c.p.month, c.p.year)})`,
  },
  "payroll.payment_created": {
    group: "hr",
    say: (c) =>
      `pagó ${money(c.p.amount) ?? "—"} de sueldo desde ${named(c, "account", "account_id", "una cuenta")}`,
  },
  "payroll.payment_bulk_created": {
    group: "hr",
    say: (c) =>
      `pagó sueldos a ${count(num(c.p.count), "empleado", "empleados")} por ${money(c.p.total) ?? "—"} desde ${named(c, "account", "account_id", "una cuenta")}`,
  },
  "payroll.payment_updated": {
    group: "hr",
    say: () => "editó un pago de sueldo",
  },
  "payroll.payment_deleted": {
    group: "hr",
    say: () => "borró un pago de sueldo",
  },

  // --- Flota ---------------------------------------------------------------
  "vehicle.created": {
    group: "fleet",
    subject: "vehicle",
    say: (c) => `dio de alta el camión ${subj(c, str(c.p.patente) ?? "nuevo")}`,
  },
  "vehicle.updated": {
    group: "fleet",
    subject: "vehicle",
    say: (c) => `editó el camión ${subj(c, "(ya borrado)")}${fieldsOf(c)}`,
  },
  "vehicle.deleted": {
    group: "fleet",
    subject: "vehicle",
    say: (c) => `borró el camión ${subj(c, "(ya borrado)")}`,
  },
  "vehicle.deactivated": {
    group: "fleet",
    subject: "vehicle",
    say: (c) => `desactivó el camión ${subj(c, "(ya borrado)")}`,
  },
  "vehicle.reactivated": {
    group: "fleet",
    subject: "vehicle",
    say: (c) => `reactivó el camión ${subj(c, "(ya borrado)")}`,
  },
  "driver.created": {
    group: "fleet",
    subject: "driver",
    say: (c) =>
      `dio de alta al chofer ${subj(c, str(c.p.full_name) ?? "nuevo")}`,
  },
  "driver.updated": {
    group: "fleet",
    subject: "driver",
    say: (c) => `editó el chofer ${subj(c, "(ya borrado)")}${fieldsOf(c)}`,
  },
  "driver.deleted": {
    group: "fleet",
    subject: "driver",
    say: (c) => `borró el chofer ${subj(c, "(ya borrado)")}`,
  },
  "driver.deactivated": {
    group: "fleet",
    subject: "driver",
    say: (c) => `desactivó el chofer ${subj(c, "(ya borrado)")}`,
  },
  "driver.reactivated": {
    group: "fleet",
    subject: "driver",
    say: (c) => `reactivó el chofer ${subj(c, "(ya borrado)")}`,
  },
  "driver.user_linked": {
    group: "fleet",
    subject: "driver",
    say: (c) =>
      `vinculó el chofer ${subj(c, "(ya borrado)")} con el usuario ${named(c, "user", "linked_user_id", "de la app")}`,
  },
  "driver.user_unlinked": {
    group: "fleet",
    subject: "driver",
    say: (c) => `desvinculó el chofer ${subj(c, "(ya borrado)")} de su usuario`,
  },
  "fuel_load.created": {
    group: "fleet",
    say: (c) =>
      `cargó una carga de combustible del ${shortDate(c.p.load_date)}`,
  },
  "fuel_load.updated": {
    group: "fleet",
    say: (c) => `editó una carga de combustible${fieldsOf(c)}`,
  },
  "fuel_load.deleted": {
    group: "fleet",
    say: () => "borró una carga de combustible",
  },
  "fuel_load.imported": {
    group: "fleet",
    say: (c) =>
      `importó ${count(num(c.p.inserted), "carga de combustible", "cargas de combustible")}${c.p.provider ? ` de ${str(c.p.provider)}` : ""}${range(c.p.from, c.p.to)}`,
  },
  "maintenance.created": {
    group: "fleet",
    say: (c) => `cargó un mantenimiento del ${shortDate(c.p.service_date)}`,
  },
  "maintenance.updated": {
    group: "fleet",
    say: (c) => `editó un mantenimiento${fieldsOf(c)}`,
  },
  "maintenance.deleted": {
    group: "fleet",
    say: () => "borró un mantenimiento",
  },
  "fleet_document.created": {
    group: "fleet",
    say: (c) =>
      `cargó ${label(FLEET_DOC_KIND_LABELS, c.p.kind) || "un documento de flota"} que vence el ${shortDate(c.p.expires_at)}`,
  },
  "fleet_document.updated": {
    group: "fleet",
    say: (c) => `editó un documento de flota${fieldsOf(c)}`,
  },
  "fleet_document.deleted": {
    group: "fleet",
    say: () => "borró un documento de flota",
  },
  "fleet_document.file_attached": {
    group: "fleet",
    say: () => "adjuntó el archivo de un documento de flota",
  },
  "fleet_document.file_removed": {
    group: "fleet",
    say: () => "quitó el archivo de un documento de flota",
  },
  "fleet_km.strix_credentials_saved": {
    group: "settings",
    say: (c) =>
      `guardó el usuario de Strix${changes([
        c.p.usernameChanged === true && "cambió el usuario",
        c.p.passwordChanged === true && "cambió la clave",
      ])}`,
  },
  "fleet_km.strix_sync_requested": {
    group: "fleet",
    say: (c) => `pidió traer km de Strix${range(c.p.from, c.p.to)}`,
  },
  "freight_tariff.list_created": {
    group: "settings",
    say: (c) =>
      `creó la lista de tarifas de flete${quoted(c.p.name)} con ${count(num(c.p.lines), "línea", "líneas")}`,
  },
  "freight_tariff.list_updated": {
    group: "settings",
    say: (c) =>
      `editó la lista de tarifas de flete${quoted(c.p.name)}${c.p.client_id ? ` (de ${named(c, "client", "client_id", "un cliente")})` : ""}`,
  },
  "freight_tariff.list_deleted": {
    group: "settings",
    say: (c) => `borró la lista de tarifas de flete${quoted(c.p.name)}`,
  },
  "freight_tariff.version_saved": {
    group: "settings",
    say: (c) =>
      `guardó la versión${quoted(c.p.label)} de una lista de tarifas de flete, vigente desde el ${shortDate(c.p.valid_from)}`,
  },
  "freight_tariff.version_deleted": {
    group: "settings",
    say: (c) =>
      `borró la versión${quoted(c.p.label)} de una lista de tarifas de flete`,
  },
  "freight_tariff.increase_applied": {
    group: "settings",
    say: (c) =>
      `aumentó ${percent(c.p.pct)} ${count(num(c.p.lists), "lista de tarifas de flete", "listas de tarifas de flete")} desde el ${shortDate(c.p.valid_from)}`,
  },

  // --- Depósito y pallets --------------------------------------------------
  "warehouse.created": {
    group: "storage",
    subject: "warehouse",
    say: (c) => `creó el depósito${quoted(c.p.name)}`,
  },
  ...prefixed("warehouse", {
    updated: {
      group: "storage",
      subject: "warehouse",
      say: (c) => `editó ${subj(c, "un depósito")}${fieldsOf(c)}`,
    },
    deleted: {
      group: "storage",
      subject: "warehouse",
      say: (c) => `borró ${subj(c, "un depósito")}`,
    },
    deactivated: {
      group: "storage",
      subject: "warehouse",
      say: (c) => `desactivó ${subj(c, "un depósito")}`,
    },
    reactivated: {
      group: "storage",
      subject: "warehouse",
      say: (c) => `reactivó ${subj(c, "un depósito")}`,
    },
  }),
  "storage_area.created": {
    group: "storage",
    say: (c) => `creó el área${quoted(c.p.name)} en un depósito`,
  },
  "storage_area.updated": {
    group: "storage",
    say: (c) => `editó un área de depósito${fieldsOf(c)}`,
  },
  "storage_area.deleted": {
    group: "storage",
    say: () => "borró un área de depósito",
  },
  "product.created": {
    group: "storage",
    subject: "product",
    say: (c) => `creó el producto${quoted(c.p.name)}`,
  },
  ...prefixed("product", {
    updated: {
      group: "storage",
      subject: "product",
      say: (c) => `editó ${subj(c, "un producto")}${fieldsOf(c)}`,
    },
    deleted: {
      group: "storage",
      subject: "product",
      say: (c) => `borró ${subj(c, "un producto")}`,
    },
    deactivated: {
      group: "storage",
      subject: "product",
      say: (c) => `desactivó ${subj(c, "un producto")}`,
    },
    reactivated: {
      group: "storage",
      subject: "product",
      say: (c) => `reactivó ${subj(c, "un producto")}`,
    },
  }),
  "pallet.created": {
    group: "storage",
    say: (c) => `ingresó el pallet${quoted(c.p.code)}`,
  },
  "pallet.bulk_created": {
    group: "storage",
    say: (c) => `ingresó ${count(num(c.p.count), "pallet", "pallets")}`,
  },
  "pallet.bulk_dispatched": {
    group: "storage",
    say: (c) =>
      `despachó ${count(num(c.p.count), "pallet", "pallets")}${num(c.p.blocked) ? ` (${num(c.p.blocked)} bloqueados no salieron)` : ""}`,
  },
  "pallet.updated": {
    group: "storage",
    say: (c) => `editó un pallet${fieldsOf(c)}`,
  },
  "pallet.deleted": { group: "storage", say: () => "borró un pallet" },
  "pallet.blocked": {
    group: "storage",
    say: (c) => `bloqueó un pallet${quoted(c.p.reason)}`,
  },
  "pallet.unblocked": {
    group: "storage",
    say: (c) => `desbloqueó un pallet${quoted(c.p.reason)}`,
  },
  "storage_tariff.created": {
    group: "storage",
    say: (c) =>
      `creó una tarifa de almacenaje de ${money(c.p.rate_per_pallet) ?? "—"} por pallet${c.p.client_id ? ` para ${named(c, "client", "client_id", "un cliente")}` : ""}`,
  },
  "storage_tariff.updated": {
    group: "storage",
    say: (c) => `editó una tarifa de almacenaje${fieldsOf(c)}`,
  },
  "storage_tariff.deleted": {
    group: "storage",
    say: () => "borró una tarifa de almacenaje",
  },
  "storage_tariff.deactivated": {
    group: "storage",
    say: () => "desactivó una tarifa de almacenaje",
  },
  "storage_tariff.reactivated": {
    group: "storage",
    say: () => "reactivó una tarifa de almacenaje",
  },
  "storage_tariff.increased": {
    group: "storage",
    say: (c) =>
      `aumentó ${percent(c.p.percent)} ${count(num(c.p.updated), "tarifa de almacenaje", "tarifas de almacenaje")} desde el ${shortDate(c.p.valid_from)}`,
  },

  // --- Tareas --------------------------------------------------------------
  "task.created": {
    group: "tasks",
    subject: "task",
    say: (c) =>
      `creó la tarea${quoted(c.p.title)}${users(c, "assignee_ids") ? ` para ${users(c, "assignee_ids")}` : ""}${c.p.due_date ? ` con vencimiento el ${shortDate(c.p.due_date)}` : ""}`,
  },
  "task.completed": {
    group: "tasks",
    subject: "task",
    say: (c) => `completó ${subj(c, "una tarea")}`,
  },
  "task.reopened": {
    group: "tasks",
    subject: "task",
    say: (c) => `reabrió ${subj(c, "una tarea")}`,
  },
  "task.commented": {
    group: "tasks",
    subject: "task",
    say: (c) => `comentó en ${subj(c, "una tarea")}`,
  },
  "task.due_date_changed": {
    group: "tasks",
    subject: "task",
    say: (c) =>
      c.p.due_date
        ? `movió el vencimiento de ${subj(c, "una tarea")} al ${shortDate(c.p.due_date)}`
        : `le quitó el vencimiento a ${subj(c, "una tarea")}`,
  },
  "task.assigned": {
    group: "tasks",
    subject: "task",
    say: (c) =>
      `cambió los responsables de ${subj(c, "una tarea")}${changes([
        users(c, "added") && `sumó a ${users(c, "added")}`,
        users(c, "removed") && `sacó a ${users(c, "removed")}`,
      ])}`,
  },
  "recurring_task.created": {
    group: "tasks",
    say: (c) =>
      `creó la tarea recurrente${quoted(c.p.title)} para el día ${str(c.p.day_of_month) ?? "—"} de cada mes`,
  },
  "recurring_task.updated": {
    group: "tasks",
    say: (c) => `editó una tarea recurrente${fieldsOf(c)}`,
  },

  // --- Archivos e importaciones --------------------------------------------
  "file.attached": {
    group: "files",
    say: (c) => `adjuntó un archivo${targetNoun(c.p.target_type)}`,
  },
  "file.detached": {
    group: "files",
    say: (c) => `quitó un archivo${targetNoun(c.p.target_type)}`,
  },
  "import_run.committed": {
    group: "files",
    say: (c) =>
      `importó ${label(IMPORT_KIND_LABELS, c.p.kind) || "datos"} desde${quoted(c.p.file_name) || " un archivo"} (${count(num(c.p.inserted), "fila nueva", "filas nuevas")}${num(c.p.filled) ? `, ${count(num(c.p.filled), "código completado", "códigos completados")}` : ""})`,
  },
  "import_run.undone": {
    group: "files",
    say: (c) =>
      `deshizo una importación de ${label(IMPORT_KIND_LABELS, c.p.kind) || "datos"}`,
  },

  // --- Usuarios y permisos -------------------------------------------------
  "user.invited": {
    group: "users",
    say: (c) =>
      `invitó a ${c.targetUser ?? "un usuario"}${roles(c.p.roles) ? ` como ${roles(c.p.roles)}` : ""}`,
  },
  "user.roles.updated": {
    group: "users",
    say: (c) =>
      `cambió los roles de ${c.targetUser ?? "un usuario"}${changes([
        roles(c.p.added) && `le dio ${roles(c.p.added)}`,
        roles(c.p.removed) && `le sacó ${roles(c.p.removed)}`,
      ])}`,
  },
  "user.access.updated": {
    group: "users",
    say: (c) => `cambió los permisos de ${c.targetUser ?? "un usuario"}`,
  },
  "user.role.granted": {
    group: "users",
    say: (c) =>
      `le dio a ${c.targetUser ?? "un usuario"} el rol ${label(ROLE_LABELS, c.p.role) || "pedido"}`,
  },

  // --- Asistente IA --------------------------------------------------------
  "ai.tool_call": {
    group: "ai",
    say: (c) => `consultó ${aiQueryLabel(c.p)}`,
  },
  "ai.proposal.accepted": { group: "ai", say: (c) => `aceptó ${proposal(c)}` },
  "ai.proposal.confirmed": {
    group: "ai",
    say: (c) => `confirmó ${proposal(c)}`,
  },
  "ai.proposal.declined": { group: "ai", say: (c) => `rechazó ${proposal(c)}` },
  "ai.proposal.dismissed": {
    group: "ai",
    say: (c) => `descartó ${proposal(c)}`,
  },
  "ai.proposal.revised": { group: "ai", say: (c) => `corrigió ${proposal(c)}` },
  "ai.proposal.failed": {
    group: "ai",
    say: (c) => `intentó aplicar ${proposal(c)}, pero falló`,
  },
  "ai.session.deleted": {
    group: "ai",
    say: () => "borró una conversación con el asistente",
  },
  "ai.artifact.pinned": {
    group: "ai",
    say: () => "fijó un gráfico o tabla del asistente",
  },
  "ai.artifact.unpinned": {
    group: "ai",
    say: () => "desfijó un gráfico o tabla del asistente",
  },
  "ai.document.extraction_requested": {
    group: "ai",
    say: () => "mandó a leer un documento escaneado",
  },
  "ai.document.confirmed": {
    group: "ai",
    say: (c) =>
      num(c.p.checks_created) !== null
        ? `confirmó un documento escaneado y cargó ${count(num(c.p.checks_created), "cheque", "cheques")}`
        : "confirmó los datos de un documento escaneado",
  },
  "ai.document.discarded": {
    group: "ai",
    say: () => "descartó un documento escaneado",
  },
  "ai.insights.regenerated": {
    group: "ai",
    say: (c) =>
      `pidió revisar los avisos del asistente (${count(num(c.p.count), "aviso", "avisos")})`,
  },
  ...Object.fromEntries(
    Object.entries(INSIGHT_STATUS).map(([status, word]) => [
      `ai.insight.${status}`,
      {
        group: "ai",
        say: () => `${word} un aviso del asistente`,
      } satisfies Spec,
    ]),
  ),
  "ai.insight.ignored": {
    group: "ai",
    say: (c) => `ignoró un aviso del asistente${quoted(c.p.reason)}`,
  },
  "ai.workflow.created": {
    group: "ai",
    say: (c) =>
      `creó una tarea automática del asistente${str(c.p.origin) === "assistant" ? " (propuesta por el asistente)" : ""}`,
  },
  "ai.workflow.paused": {
    group: "ai",
    say: () => "pausó una tarea automática del asistente",
  },
  "ai.workflow.resumed": {
    group: "ai",
    say: () => "reanudó una tarea automática del asistente",
  },
  "ai.workflow.deleted": {
    group: "ai",
    say: () => "borró una tarea automática del asistente",
  },

  // --- Configuración -------------------------------------------------------
  "afip.pos_configured": {
    group: "settings",
    say: (c) =>
      `${c.p.is_enabled === false ? "deshabilitó" : "configuró"} el punto de venta ${String(num(c.p.numero) ?? "").padStart(4, "0")} de AFIP`,
  },
  "afip.pos_synced": {
    group: "settings",
    say: (c) => `trajo de AFIP los puntos de venta (${num(c.p.total) ?? 0})`,
  },
  "afip.issued_sync_requested": {
    group: "settings",
    say: () => "pidió traer de AFIP los comprobantes emitidos",
  },
  "afip.arca_web_credentials_saved": {
    group: "settings",
    say: (c) =>
      `guardó el usuario de ARCA${changes([
        c.p.cuitChanged === true && "cambió el CUIT",
        c.p.passwordChanged === true && "cambió la clave",
      ])}`,
  },
  "caea.requested": { group: "settings", say: () => "pidió el CAEA a AFIP" },

  // --- Exportaciones y copias ----------------------------------------------
  "audit.exported": {
    group: "exports",
    say: (c) =>
      `exportó la auditoría (${count(num(c.p.rows), "evento", "eventos")})`,
  },
  "backup.downloaded": {
    group: "exports",
    say: () => "descargó una copia de seguridad",
  },
  "management.exported": {
    group: "exports",
    say: () => "exportó el resultado de gestión",
  },
};

// ---------------------------------------------------------------------------
// Small builders used above.
// ---------------------------------------------------------------------------

function prefixed(
  prefix: string,
  specs: Record<string, Spec>,
): Record<string, Spec> {
  return Object.fromEntries(
    Object.entries(specs).map(([action, spec]) => [
      `${prefix}.${action}`,
      spec,
    ]),
  );
}

function periodOf(v: JsonValue | undefined): JsonValue | undefined {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    return v.period ?? v.month ?? undefined;
  }
  return v;
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function monthYear(
  month: JsonValue | undefined,
  year: JsonValue | undefined,
): string {
  const m = num(month);
  const name = m !== null ? MONTHS[m - 1] : undefined;
  return [name, str(year)].filter(Boolean).join(" ") || "un período";
}

const TARGET_NOUNS: Record<string, string> = {
  invoice: "a un comprobante",
  receipt: "a un recibo",
  payment_order: "a una orden de pago",
  purchase_invoice: "a una factura de compra",
  client: "a un cliente",
  supplier: "a un proveedor",
  employee: "a un empleado",
  vehicle: "a un camión",
  trip: "a un viaje",
  transaction: "a un movimiento de caja",
};

function targetNoun(v: JsonValue | undefined): string {
  const s = str(v);
  return s ? ` ${TARGET_NOUNS[s] ?? "a un registro"}` : "";
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/** Every action the registry knows (the coverage test reads it). */
export const AUDIT_ACTION_TYPES: readonly string[] = Object.keys(AUDIT_ACTIONS);

export function auditSubjectKind(eventType: string): EntityKind | null {
  return AUDIT_ACTIONS[eventType]?.subject ?? null;
}

export function auditGroupOf(eventType: string): AuditGroupId | null {
  return AUDIT_ACTIONS[eventType]?.group ?? null;
}

export function auditGroupLabel(group: AuditGroupId | null): string {
  return AUDIT_GROUPS.find((g) => g.id === group)?.label ?? "Otros";
}

/** The event types of a «Qué» group, for the server filter. */
export function auditEventTypesOf(group: AuditGroupId): string[] {
  return AUDIT_ACTION_TYPES.filter((t) => AUDIT_ACTIONS[t]?.group === group);
}

const VERBS: Record<string, string> = {
  created: "creó",
  updated: "editó",
  deleted: "borró",
  cancelled: "anuló",
  canceled: "anuló",
  confirmed: "confirmó",
  requested: "pidió",
  exported: "exportó",
  imported: "importó",
  applied: "aplicó",
  set: "cambió",
};

/** An action the registry does not know yet, in words: «editó algo en
 *  Facturación (invoice draft)». Never the raw payload. */
export function humanizeEventType(eventType: string): string {
  const parts = eventType.split(".");
  const last = parts.at(-1) ?? eventType;
  const verb = VERBS[last];
  const what = parts
    .slice(0, verb ? -1 : undefined)
    .join(" ")
    .replaceAll("_", " ");
  return verb
    ? `${verb} ${what}`
    : `hizo «${eventType.replaceAll("_", " ").replaceAll(".", " · ")}»`;
}

/** The event as a sentence, without its actor. */
export function auditSentence(eventType: string, input: SentenceInput): string {
  const spec = AUDIT_ACTIONS[eventType];
  return spec ? spec.say(input) : humanizeEventType(eventType);
}
