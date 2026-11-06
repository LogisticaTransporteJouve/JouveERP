import { z } from "zod";

import { MatchLineSchema } from "@/features/bank-reconciliation/schema";
import {
  CHECK_KIND_LABEL,
  DepositChequeSchema,
  ManualChequeCreateSchema,
} from "@/features/checks/schema";
import {
  CLIENT_TARIFF_CONCEPT_LABELS,
  CLIENT_TARIFF_UNIT_LABELS,
  ClientTariffCreateSchema,
} from "@/features/client-tariffs/schema";
import {
  ClientCreateSchema,
  ClientUpdateSchema,
  isIvaCondition,
  IVA_CONDITION_LABEL,
  ivaConditionLabel,
} from "@/features/clients/schema";
import {
  type ExpenseSource,
  RecategorizeExpenseSchema,
} from "@/features/cost-centers/schema";
import {
  rateJumpWarningFor,
  type RateReference,
} from "@/features/exchange-rates/lib/rate-jump";
import { ExchangeRateCreateSchema } from "@/features/exchange-rates/schema";
import {
  DIFFERENCE_CHARGED_TO,
  DriverSettlementConfirmSchema,
  DriverSettlementDifferenceSchema,
  DriverSettlementSaveSchema,
  settlementDifference,
} from "@/features/driver-settlements/schema";
import {
  FreightSettlementConfirmSchema,
  FreightSettlementSaveSchema,
} from "@/features/freight-settlements/schema";
import { FuelLoadCreateSchema } from "@/features/fuel/schema";
import {
  ACCOUNT_MOVEMENT_KIND_LABEL,
  CreateManualMovementSchema,
  CREDITOR_LABEL,
  RecordAccountCashSchema,
} from "@/features/hr/account-schema";
import {
  ATTENDANCE_KIND_LABEL,
  ATTENDANCE_KINDS,
  UpsertAttendanceSchema,
} from "@/features/hr/attendance-schema";
import {
  BulkCreatePayrollPaymentsSchema,
  PAYROLL_PAYMENT_METHOD_LABEL,
} from "@/features/hr/payroll-schema";
import {
  EMPLOYEE_POSITIONS,
  EmployeeCreateSchema,
  EmployeeUpdateSchema,
  isDriverPosition,
  isPayFrequency,
  PAY_FREQUENCIES,
  PAY_FREQUENCY_LABEL,
} from "@/features/hr/schema";
import {
  CreateLeaveSchema,
  LEAVE_KIND_LABEL,
  LEAVE_KINDS,
} from "@/features/hr/vacation-schema";
import { leaveDays, leaveWarnings } from "@/features/hr/lib/leaves";
import {
  computeLineAmounts,
  computeTotals,
  CreateComprobanteSchema,
  invoiceKindLabel,
  SendInvoiceEmailSchema,
} from "@/features/invoices/schema";
import {
  ISSUED_CHECK_KIND_LABEL,
  IssuedCheckCreateSchema,
} from "@/features/issued-checks/schema";
import { ManualJournalEntryCreateSchema } from "@/features/journal-entries/schema";
import { IssueLateInterestSchema } from "@/features/late-interest/schema";
import { PayInstallmentSchema } from "@/features/loans/schema";
import {
  MAINTENANCE_KIND_LABELS,
  MAINTENANCE_KINDS,
  MaintenanceCreateSchema,
} from "@/features/maintenance/schema";
import { PaymentOrderCreateSchema } from "@/features/payment-orders/schema";
import { arcaGapTargetLabel } from "@/features/purchase-invoices/lib/arca-received-draft";
import {
  ARCA_GAP_TARGETS,
  PURCHASE_TRIBUTE_FIELDS,
  PURCHASE_TRIBUTE_LABEL,
  PurchaseInvoiceCreateSchema,
  purchaseKindLabel,
} from "@/features/purchase-invoices/schema";
import {
  ReceiptCreateSchema,
  RETENTION_KIND_LABEL,
  RETENTION_TAX_TYPE_LABEL,
  SendReceiptEmailSchema,
} from "@/features/receipts/schema";
import {
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_TARGET_STATUSES,
  ShipmentCreateSchema,
  ShipmentStatusChangeSchema,
} from "@/features/shipments/schema";
import { StorageInvoiceProposalSchema } from "@/features/storage-billing/schema";
import {
  SupplierCreateSchema,
  SupplierUpdateSchema,
} from "@/features/suppliers/schema";
import { TaskCreateSchema } from "@/features/tasks/schema";
import {
  PayTaxDocumentSchema,
  TAX_KIND_LABEL,
  TaxDocumentCreateSchema,
  taxDocumentLabel,
} from "@/features/taxes/schema";
import {
  TRANSACTION_KIND_LABEL,
  TransactionCreateSchema,
  TransferCreateSchema,
} from "@/features/transactions/schema";
import {
  TRIP_STATUS_LABELS,
  TRIP_STATUSES,
  TripCreateSchema,
} from "@/features/trips/schema";
import { ivaRatePercent, MONEDA } from "@/lib/afip/codes";
import {
  amountToInput,
  formatAmountInput,
  formatArgentineDate,
  formatInteger,
  formatMoney,
  formatPeriod,
  formatRate,
  parseArAmount,
} from "@/lib/format";

import { DOCUMENT_TYPE_LABELS } from "../document/lib/document-config";
import { DOCUMENT_KINDS } from "../document/types";
import {
  AiWorkflowDraftSchema,
  CADENCE_LABEL,
  WEEKDAY_LABEL,
  WEEKDAYS,
  WORKFLOW_CADENCES,
  describeSchedule,
  draftSchedule,
} from "../workflows/schema";

/**
 * What a proposal card needs on both sides of the wire: the draft schema (the
 * manual form's own Zod), the fields the user may edit in the Modify dialog,
 * and how a draft reads as summary rows. The server proposal (registry) and
 * the card (client) both read it from here, by action name.
 */

export type ProposalSummaryRow = { label: string; value: string };

/** The label of a summary row that warns without blocking: the card shows
 *  it as a notice under the summary. */
export const PROPOSAL_WARNING_LABEL = "Atención";

/** Display names the server resolved for ids in the draft (an employee's
 *  name, an account's code and name), stored with each revision. */
export type ProposalLabels = Record<string, string>;

export type ProposalField = {
  key: string;
  label: string;
  kind: "date" | "text" | "textarea" | "number" | "select";
  options?: readonly { value: string; label: string }[];
  /** number only: decimals the input keeps (default 2, money). */
  decimals?: number;
};

/** A draft field as the Modify dialog's input shows it (es-AR numbers). */
export function fieldInputText(draft: unknown, field: ProposalField): string {
  if (typeof draft !== "object" || draft === null) return "";
  const value: unknown = Reflect.get(draft, field.key);
  if (typeof value === "number") {
    return field.kind === "number"
      ? amountToInput(value, field.decimals)
      : String(value);
  }
  return typeof value === "string" ? value : "";
}

/** Live formatting of what the user types into a field. */
export function formatFieldInput(field: ProposalField, raw: string): string {
  return field.kind === "number" ? formatAmountInput(raw, field.decimals) : raw;
}

/** The draft value a field's input text stands for. */
export function fieldInputValue(field: ProposalField, text: string): unknown {
  if (field.kind === "number") return parseArAmount(text) ?? Number.NaN;
  if (field.kind === "textarea") return text.trim() ? text.trim() : null;
  return text;
}

export type ProposalIssue = { field: string; message: string };

type ProposalSpecDef<D extends z.ZodType> = {
  /** Card heading. */
  title: string;
  draft: D;
  fields: readonly ProposalField[];
  confirmLabel: string;
  declineLabel: string;
  summarize: (
    draft: z.output<D>,
    labels: ProposalLabels,
  ) => ProposalSummaryRow[];
};

export type ProposalValidation =
  | { ok: true; draft: unknown; summary: ProposalSummaryRow[] }
  | { ok: false; issues: ProposalIssue[] };

/** A spec with its draft type erased, so specs of every action share a map. */
export type ProposalSpec = {
  readonly title: string;
  readonly fields: readonly ProposalField[];
  readonly confirmLabel: string;
  readonly declineLabel: string;
  /** Parses a draft with the form's schema; on success the parsed draft (what
   *  gets stored and executed) and its summary rows. */
  validate: (raw: unknown, labels: ProposalLabels) => ProposalValidation;
};

export type TypedProposalSpec<D extends z.ZodType> = ProposalSpec & {
  readonly draft: D;
};

export function zodIssues(error: z.ZodError): ProposalIssue[] {
  return error.issues.map((i) => ({
    field: i.path.join(".") || "draft",
    message: i.message,
  }));
}

function defineProposalSpec<D extends z.ZodType>(
  def: ProposalSpecDef<D>,
): TypedProposalSpec<D> {
  return {
    title: def.title,
    draft: def.draft,
    fields: def.fields,
    confirmLabel: def.confirmLabel,
    declineLabel: def.declineLabel,
    validate: (raw, labels) => {
      const parsed = def.draft.safeParse(raw);
      if (!parsed.success)
        return { ok: false, issues: zodIssues(parsed.error) };
      return {
        ok: true,
        draft: parsed.data,
        summary: def.summarize(parsed.data, labels),
      };
    },
  };
}

/** Keys of the labels a leave draft carries for its warnings, read by the
 *  server when it drafts the proposal and kept across the user's edits. */
export const LEAVE_LABELS = {
  /** Pending vacation days, or "none" when no balance is loaded. */
  pending: "leave_pending_days",
  /** Holiday dates around the start, comma-separated. */
  holidays: "leave_holidays",
  /** "1" when the balance or the holidays could not be read. */
  unread: "leave_context_unread",
} as const;

/** The pending days a leave draft's label holds: a number, null for "no
 *  balance loaded", undefined when absent or unreadable. */
function pendingFromLabel(
  value: string | undefined,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === "none") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** The vacation warnings of a leave draft (LCT art. 151 start day and the
 *  pending balance), from what the server read when it drafted it. */
function leaveWarningRows(
  d: z.output<typeof CreateLeaveSchema>,
  labels: ProposalLabels,
): ProposalSummaryRow[] {
  if (d.kind !== "vacaciones") return [];
  const warnings = leaveWarnings(d, {
    holidays: new Set(
      (labels[LEAVE_LABELS.holidays] ?? "").split(",").filter(Boolean),
    ),
    pending: pendingFromLabel(labels[LEAVE_LABELS.pending]),
  });
  if (labels[LEAVE_LABELS.unread] === "1") {
    warnings.push(
      "No se pudieron leer el saldo de vacaciones o los feriados para revisar la licencia.",
    );
  }
  return warnings.map((value) => ({ label: PROPOSAL_WARNING_LABEL, value }));
}

export const leaveProposalSpec = defineProposalSpec({
  title: "Registrar licencia",
  draft: CreateLeaveSchema,
  fields: [
    { key: "start_date", label: "Desde", kind: "date" },
    { key: "end_date", label: "Hasta", kind: "date" },
    {
      key: "kind",
      label: "Tipo",
      kind: "select",
      options: LEAVE_KINDS.map((k) => ({
        value: k,
        label: LEAVE_KIND_LABEL[k],
      })),
    },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Registrar licencia",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Empleado", value: labels[d.employee_id] ?? d.employee_id },
    { label: "Tipo", value: LEAVE_KIND_LABEL[d.kind] },
    { label: "Desde", value: formatArgentineDate(d.start_date) },
    { label: "Hasta", value: formatArgentineDate(d.end_date) },
    {
      label: "Días corridos",
      value: String(leaveDays(d.start_date, d.end_date)),
    },
    ...(d.notes ? [{ label: "Notas", value: d.notes }] : []),
    ...leaveWarningRows(d, labels),
  ],
});

export const journalEntryProposalSpec = defineProposalSpec({
  title: "Cargar asiento manual",
  draft: ManualJournalEntryCreateSchema,
  fields: [
    { key: "entry_date", label: "Fecha", kind: "date" },
    { key: "description", label: "Descripción", kind: "text" },
  ],
  confirmLabel: "Cargar asiento",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Fecha", value: formatArgentineDate(d.entry_date) },
    { label: "Descripción", value: d.description },
    ...d.lines.map((l) => ({
      label: labels[l.account_id] ?? l.account_id,
      value:
        l.debit > 0
          ? `Debe ${formatMoney(l.debit)}${l.description ? ` · ${l.description}` : ""}`
          : `Haber ${formatMoney(l.credit)}${l.description ? ` · ${l.description}` : ""}`,
    })),
    {
      label: "Total",
      value: formatMoney(d.lines.reduce((a, l) => a + l.debit, 0)),
    },
  ],
});

// The stored rate a proposed one is compared with travels in the labels, so
// a revision («Modificar») re-checks its new rate against it.
const RATE_REF_DATE = "rate_ref_date";
const RATE_REF_RATE = "rate_ref_rate";
const RATE_REF_EARLIER = "rate_ref_earlier";
const RATE_REF_UNREAD = "rate_ref_unread";

/** The labels that carry the reference rate: `null` when none is stored,
 *  `"unread"` when it could not be read. */
export function rateReferenceLabels(
  ref: RateReference | null | "unread",
): ProposalLabels {
  if (ref === "unread") return { [RATE_REF_UNREAD]: "1" };
  if (!ref) return {};
  return {
    [RATE_REF_DATE]: ref.rate_date,
    [RATE_REF_RATE]: String(ref.rate),
    [RATE_REF_EARLIER]: ref.earlier ? "1" : "0",
  };
}

function rateJumpRow(
  rate: number,
  labels: ProposalLabels,
): ProposalSummaryRow | null {
  if (labels[RATE_REF_UNREAD]) {
    return {
      label: PROPOSAL_WARNING_LABEL,
      value:
        "No se pudo leer la cotización guardada para compararla. Revisá el número antes de guardar.",
    };
  }
  const refDate = labels[RATE_REF_DATE];
  const refRate = Number(labels[RATE_REF_RATE]);
  if (!refDate || !Number.isFinite(refRate)) return null;
  const warning = rateJumpWarningFor(
    {
      rate_date: refDate,
      rate: refRate,
      earlier: labels[RATE_REF_EARLIER] === "1",
    },
    rate,
  );
  return warning ? { label: PROPOSAL_WARNING_LABEL, value: warning } : null;
}

export const exchangeRateProposalSpec = defineProposalSpec({
  title: "Cargar cotización USD",
  draft: ExchangeRateCreateSchema,
  fields: [
    { key: "rate_date", label: "Fecha", kind: "date" },
    {
      key: "rate",
      label: "Cotización (ARS por USD)",
      kind: "number",
      decimals: 6,
    },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Guardar cotización",
  declineLabel: "Descartar",
  summarize: (d, labels) => {
    const jump = rateJumpRow(d.rate, labels);
    return [
      { label: "Fecha", value: formatArgentineDate(d.rate_date) },
      { label: "Cotización", value: `$ ${formatRate(d.rate)}` },
      ...(jump ? [jump] : []),
      { label: "Fuente", value: "Manual (reemplaza la del BCRA de ese día)" },
      ...(d.notes ? [{ label: "Notas", value: d.notes }] : []),
    ];
  },
});

export const workflowProposalSpec = defineProposalSpec({
  title: "Programar tarea de IA",
  draft: AiWorkflowDraftSchema,
  fields: [
    { key: "title", label: "Nombre", kind: "text" },
    { key: "prompt", label: "Qué tiene que hacer", kind: "textarea" },
    {
      key: "cadence",
      label: "Frecuencia",
      kind: "select",
      options: WORKFLOW_CADENCES.map((c) => ({
        value: c,
        label: CADENCE_LABEL[c],
      })),
    },
    { key: "runTime", label: "Hora (HH:MM, Buenos Aires)", kind: "text" },
    {
      key: "weekday",
      label: "Día de la semana (semanal)",
      kind: "select",
      options: WEEKDAYS.map((d) => ({ value: d, label: WEEKDAY_LABEL[d] })),
    },
    {
      key: "monthDay",
      label: "Día del mes, 1 a 28 (mensual)",
      kind: "number",
      decimals: 0,
    },
  ],
  confirmLabel: "Programar tarea",
  declineLabel: "Descartar",
  summarize: (d) => [
    { label: "Nombre", value: d.title },
    { label: "Pedido", value: d.prompt },
    {
      label: "Cuándo",
      value: `${describeSchedule(draftSchedule(d))} (hora de Buenos Aires)`,
    },
    {
      label: "Cómo corre",
      value:
        "Solo consulta datos con tus permisos; el resultado queda en Tareas IA.",
    },
  ],
});

/** "Auto" lets Document Intelligence classify the file itself. */
export const DOCUMENT_SCAN_TYPES = ["auto", ...DOCUMENT_KINDS] as const;

export const DocumentScanDraftSchema = z.object({
  file_id: z.string().uuid(),
  declared_type: z.enum(DOCUMENT_SCAN_TYPES),
});

function scanTypeLabel(type: (typeof DOCUMENT_SCAN_TYPES)[number]): string {
  return type === "auto"
    ? "Detectar automáticamente"
    : (DOCUMENT_TYPE_LABELS[type] ?? type);
}

export const documentScanProposalSpec = defineProposalSpec({
  title: "Mandar a Documentos",
  draft: DocumentScanDraftSchema,
  fields: [
    {
      key: "declared_type",
      label: "Tipo de documento",
      kind: "select",
      options: DOCUMENT_SCAN_TYPES.map((t) => ({
        value: t,
        label: scanTypeLabel(t),
      })),
    },
  ],
  confirmLabel: "Mandar a Documentos",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Archivo", value: labels[d.file_id] ?? "Adjunto del chat" },
    { label: "Tipo", value: scanTypeLabel(d.declared_type) },
    {
      label: "Qué pasa",
      value:
        "Document Intelligence lee el archivo y deja un borrador en Documentos para que lo revises; no se carga nada sin tu confirmación.",
    },
  ],
});

export const taskProposalSpec = defineProposalSpec({
  title: "Crear tarea",
  draft: TaskCreateSchema,
  fields: [
    { key: "title", label: "Título", kind: "text" },
    { key: "description", label: "Descripción", kind: "textarea" },
    { key: "due_date", label: "Vence", kind: "date" },
  ],
  confirmLabel: "Crear tarea",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Título", value: d.title },
    ...(d.description ? [{ label: "Descripción", value: d.description }] : []),
    {
      label: "Vence",
      value: d.due_date ? formatArgentineDate(d.due_date) : "Sin fecha",
    },
    {
      label: "Responsables",
      value: d.assignee_ids.length
        ? d.assignee_ids.map((id) => labels[id] ?? id).join(", ")
        : "Sin asignar",
    },
  ],
});

export const clientTariffProposalSpec = defineProposalSpec({
  title: "Cargar tarifa del cliente",
  draft: ClientTariffCreateSchema,
  fields: [
    { key: "price", label: "Precio", kind: "number" },
    { key: "valid_from", label: "Vigente desde", kind: "date" },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Cargar tarifa",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Cliente", value: labels[d.client_id] ?? d.client_id },
    { label: "Concepto", value: CLIENT_TARIFF_CONCEPT_LABELS[d.concept] },
    { label: "Unidad", value: CLIENT_TARIFF_UNIT_LABELS[d.unit] },
    { label: "Precio", value: formatMoney(d.price, d.currency) },
    { label: "Vigente desde", value: formatArgentineDate(d.valid_from) },
    {
      label: "Hasta",
      value: d.valid_to ? formatArgentineDate(d.valid_to) : "Sin fecha de fin",
    },
    ...(d.area_id
      ? [{ label: "Área", value: labels[d.area_id] ?? d.area_id }]
      : []),
    ...(d.notes ? [{ label: "Notas", value: d.notes }] : []),
  ],
});

/** Up to this many suggested matches go in one proposal (the page accepts
 *  up to 200 at once; a card lists each one). */
export const MAX_PROPOSED_MATCHES = 30;

export const BankMatchesDraftSchema = z.object({
  account_id: z.string().uuid(),
  matches: z
    .array(MatchLineSchema)
    .min(1, "No hay sugerencias para conciliar.")
    .max(MAX_PROPOSED_MATCHES),
});

export const bankMatchesProposalSpec = defineProposalSpec({
  title: "Conciliar extracto",
  draft: BankMatchesDraftSchema,
  fields: [],
  confirmLabel: "Conciliar",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Cuenta", value: labels[d.account_id] ?? d.account_id },
    ...d.matches.map((m) => ({
      label: labels[m.line_id] ?? m.line_id,
      value: m.transaction_ids.map((id) => labels[id] ?? id).join(" + "),
    })),
    {
      label: "Qué pasa",
      value:
        "Cada línea se concilia con su movimiento, como al aceptar las sugerencias en Conciliación; una línea que cambió mientras tanto se saltea.",
    },
  ],
});

export const LateInterestNdDraftSchema = IssueLateInterestSchema.extend({
  /** The interest the card showed; the ND is refused if it changed. */
  expected_interest: z.number().positive(),
});

/** Keys of the display labels a late-interest draft carries. */
export const LATE_INTEREST_LABELS = {
  client: "client",
  comprobante: "comprobante",
  base: "base",
  period: "period",
  interest: "interest",
} as const;

export const lateInterestNdProposalSpec = defineProposalSpec({
  title: "Generar ND por mora",
  draft: LateInterestNdDraftSchema,
  fields: [],
  confirmLabel: "Emitir ND",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Cliente", value: labels[LATE_INTEREST_LABELS.client] ?? "—" },
    {
      label: "Comprobante",
      value: labels[LATE_INTEREST_LABELS.comprobante] ?? d.invoice_id,
    },
    { label: "Saldo vencido", value: labels[LATE_INTEREST_LABELS.base] ?? "—" },
    {
      label: "Período",
      value:
        labels[LATE_INTEREST_LABELS.period] ??
        `hasta el ${formatArgentineDate(d.as_of)}`,
    },
    { label: "Tasa mensual", value: `${formatRate(d.monthly_rate)} %` },
    {
      label: "Interés (neto, más IVA 21 %)",
      value:
        labels[LATE_INTEREST_LABELS.interest] ??
        formatMoney(d.expected_interest),
    },
    { label: "Punto de venta", value: String(d.punto_venta) },
    {
      label: "Qué pasa",
      value:
        "Al aceptar se emite la nota de débito como en Intereses por mora: con CAE de AFIP en el canal fiscal, remito interno en el interno. Si el saldo cambió, no se emite.",
    },
  ],
});

/** Keys of the display labels a recategorize draft carries (the ids of the
 *  new account and center carry their own). */
export const RECATEGORIZE_LABELS = {
  expense: "expense",
  accountBefore: "account_before",
  costCenterBefore: "cost_center_before",
} as const;

const DEFAULT_EXPENSE_ACCOUNT: Record<ExpenseSource, string> = {
  transactions: "Gastos (sin cuenta propia)",
  purchase_invoices: "Compras (sin cuenta propia)",
};

export const recategorizeExpenseProposalSpec = defineProposalSpec({
  title: "Recategorizar gasto",
  draft: RecategorizeExpenseSchema,
  fields: [],
  confirmLabel: "Recategorizar",
  declineLabel: "Descartar",
  summarize: (d, labels) => {
    const before = (key: string) => labels[key] ?? "—";
    return [
      {
        label: d.source === "transactions" ? "Movimiento" : "Compra",
        value: labels[RECATEGORIZE_LABELS.expense] ?? d.id,
      },
      ...(d.expense_account_id !== undefined
        ? [
            {
              label: "Cuenta de gasto",
              value: `${before(RECATEGORIZE_LABELS.accountBefore)} → ${
                d.expense_account_id
                  ? (labels[d.expense_account_id] ?? d.expense_account_id)
                  : DEFAULT_EXPENSE_ACCOUNT[d.source]
              }`,
            },
          ]
        : []),
      ...(d.cost_center_id !== undefined
        ? [
            {
              label: "Centro de costo",
              value: `${before(RECATEGORIZE_LABELS.costCenterBefore)} → ${
                d.cost_center_id
                  ? (labels[d.cost_center_id] ?? d.cost_center_id)
                  : "Sin centro de costo"
              }`,
            },
          ]
        : []),
      {
        label: "Qué pasa",
        value:
          "Cambia solo la imputación, como Recategorizar en la lista: el asiento se rehace y el monto, la fecha y la conciliación quedan igual. Un período cerrado no se toca.",
      },
    ];
  },
});

// ─── Fleet & operations ──────────────────────────────────────────────────────

function kmText(km: number): string {
  return `${km.toLocaleString("es-AR", { maximumFractionDigits: 1 })} km`;
}

/** A summary row only when the draft has a value for it. */
function rowIf(
  label: string,
  value: string | null | undefined,
): ProposalSummaryRow[] {
  return value ? [{ label, value }] : [];
}

/** "Origen → Destino", or the one that is set. */
function routeText(
  origin: string | null | undefined,
  destination: string | null | undefined,
): string | null {
  if (origin && destination) return `${origin} → ${destination}`;
  return origin ?? destination ?? null;
}

export const tripProposalSpec = defineProposalSpec({
  title: "Crear viaje",
  draft: TripCreateSchema,
  fields: [
    { key: "trip_date", label: "Fecha", kind: "date" },
    { key: "origin", label: "Origen", kind: "text" },
    { key: "destination", label: "Destino", kind: "text" },
    { key: "cargo_description", label: "Carga", kind: "textarea" },
    {
      key: "status",
      label: "Estado",
      kind: "select",
      options: TRIP_STATUSES.map((s) => ({
        value: s,
        label: TRIP_STATUS_LABELS[s],
      })),
    },
    { key: "km", label: "Km", kind: "number", decimals: 0 },
    { key: "revenue", label: "Ingreso", kind: "number" },
    { key: "cost", label: "Costo", kind: "number" },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Crear viaje",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Fecha", value: formatArgentineDate(d.trip_date) },
    ...rowIf(
      "Vehículo",
      d.vehicle_id ? (labels[d.vehicle_id] ?? d.vehicle_id) : null,
    ),
    ...rowIf(
      "Chofer",
      d.driver_id ? (labels[d.driver_id] ?? d.driver_id) : null,
    ),
    ...rowIf("Recorrido", routeText(d.origin, d.destination)),
    ...rowIf("Carga", d.cargo_description),
    { label: "Estado", value: TRIP_STATUS_LABELS[d.status] },
    ...rowIf("Km", d.km != null ? kmText(d.km) : null),
    ...rowIf("Ingreso", d.revenue != null ? formatMoney(d.revenue) : null),
    ...rowIf("Costo", d.cost != null ? formatMoney(d.cost) : null),
    ...rowIf("Notas", d.notes),
  ],
});

export const shipmentProposalSpec = defineProposalSpec({
  title: "Crear carga",
  draft: ShipmentCreateSchema,
  fields: [
    { key: "remito_number", label: "Remito", kind: "text" },
    { key: "scheduled_date", label: "Fecha programada", kind: "date" },
    { key: "origin", label: "Origen", kind: "text" },
    { key: "destination", label: "Destino", kind: "text" },
    { key: "description", label: "Descripción", kind: "textarea" },
    { key: "freight_amount", label: "Flete", kind: "number" },
    { key: "cod_amount", label: "Contra entrega", kind: "number" },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Crear carga",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    {
      label: "Cliente",
      value: d.client_id ? (labels[d.client_id] ?? d.client_id) : "Sin cliente",
    },
    ...rowIf("Remito", d.remito_number),
    ...rowIf(
      "Fecha programada",
      d.scheduled_date ? formatArgentineDate(d.scheduled_date) : null,
    ),
    ...rowIf("Recorrido", routeText(d.origin, d.destination)),
    ...rowIf("Descripción", d.description),
    ...rowIf(
      "Flete",
      d.freight_amount != null ? formatMoney(d.freight_amount) : null,
    ),
    ...rowIf(
      "Contra entrega",
      d.cod_amount != null ? formatMoney(d.cod_amount) : null,
    ),
    ...rowIf("Notas", d.notes),
    { label: "Estado", value: SHIPMENT_STATUS_LABELS.not_started },
  ],
});

export const CANCEL_REASON_REQUIRED = "El motivo es obligatorio.";

/** The status dialog's input and its rules: a target status, and a reason to
 *  cancel. */
export const ShipmentStatusDraftSchema = ShipmentStatusChangeSchema.extend({
  status: z.enum(SHIPMENT_TARGET_STATUSES),
}).superRefine((v, ctx) => {
  if (v.status === "cancelled" && !v.failure_reason) {
    ctx.addIssue({
      code: "custom",
      path: ["failure_reason"],
      message: CANCEL_REASON_REQUIRED,
    });
  }
});

/** Keys of the display labels a status-change draft carries. */
export const SHIPMENT_STATUS_LABEL_KEYS = {
  shipment: "shipment",
  statusBefore: "status_before",
} as const;

export const shipmentStatusProposalSpec = defineProposalSpec({
  title: "Cambiar estado de la carga",
  draft: ShipmentStatusDraftSchema,
  fields: [
    { key: "delivery_date", label: "Fecha de entrega", kind: "date" },
    { key: "scheduled_date", label: "Nueva fecha programada", kind: "date" },
    { key: "failure_reason", label: "Motivo", kind: "textarea" },
    { key: "comment", label: "Comentario", kind: "textarea" },
  ],
  confirmLabel: "Cambiar estado",
  declineLabel: "Descartar",
  summarize: (d, labels) => {
    const before = labels[SHIPMENT_STATUS_LABEL_KEYS.statusBefore];
    return [
      {
        label: "Carga",
        value: labels[SHIPMENT_STATUS_LABEL_KEYS.shipment] ?? d.id,
      },
      {
        label: "Estado",
        value: `${before ?? "—"} → ${SHIPMENT_STATUS_LABELS[d.status]}`,
      },
      ...(d.status === "delivered"
        ? [
            {
              label: "Fecha de entrega",
              value: d.delivery_date
                ? formatArgentineDate(d.delivery_date)
                : "Hoy",
            },
          ]
        : []),
      ...(d.status === "reprogrammed"
        ? rowIf(
            "Nueva fecha programada",
            d.scheduled_date ? formatArgentineDate(d.scheduled_date) : null,
          )
        : []),
      ...(d.status === "cancelled" || d.status === "reprogrammed"
        ? rowIf("Motivo", d.failure_reason)
        : []),
      ...rowIf("Comentario", d.comment),
      {
        label: "Qué pasa",
        value:
          "Cambia el estado como en Cargas y queda en el historial; si la carga cambió de estado mientras tanto, no se toca.",
      },
    ];
  },
});

export const fuelLoadProposalSpec = defineProposalSpec({
  title: "Registrar carga de combustible",
  draft: FuelLoadCreateSchema,
  fields: [
    { key: "load_date", label: "Fecha", kind: "date" },
    { key: "liters", label: "Litros", kind: "number" },
    { key: "amount", label: "Importe", kind: "number" },
    { key: "odometer_km", label: "Odómetro (km)", kind: "number", decimals: 0 },
    { key: "station", label: "Estación", kind: "text" },
    { key: "card", label: "Tarjeta", kind: "text" },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Registrar carga",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Vehículo", value: labels[d.vehicle_id] ?? d.vehicle_id },
    { label: "Fecha", value: formatArgentineDate(d.load_date) },
    {
      label: "Litros",
      value: d.liters.toLocaleString("es-AR", { maximumFractionDigits: 2 }),
    },
    { label: "Importe", value: formatMoney(d.amount) },
    ...rowIf("Odómetro", d.odometer_km != null ? kmText(d.odometer_km) : null),
    ...rowIf("Estación", d.station),
    ...rowIf("Tarjeta", d.card),
    ...rowIf("Notas", d.notes),
  ],
});

export const maintenanceProposalSpec = defineProposalSpec({
  title: "Registrar mantenimiento",
  draft: MaintenanceCreateSchema,
  fields: [
    { key: "service_date", label: "Fecha", kind: "date" },
    {
      key: "kind",
      label: "Tipo",
      kind: "select",
      options: MAINTENANCE_KINDS.map((k) => ({
        value: k,
        label: MAINTENANCE_KIND_LABELS[k],
      })),
    },
    { key: "description", label: "Descripción", kind: "textarea" },
    { key: "cost", label: "Costo", kind: "number" },
    { key: "odometer_km", label: "Odómetro (km)", kind: "number", decimals: 0 },
    {
      key: "next_service_date",
      label: "Próximo service (fecha)",
      kind: "date",
    },
    {
      key: "next_service_km",
      label: "Próximo service (km)",
      kind: "number",
      decimals: 0,
    },
    { key: "provider", label: "Proveedor / taller", kind: "text" },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Registrar mantenimiento",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Vehículo", value: labels[d.vehicle_id] ?? d.vehicle_id },
    { label: "Fecha", value: formatArgentineDate(d.service_date) },
    { label: "Tipo", value: MAINTENANCE_KIND_LABELS[d.kind] },
    { label: "Descripción", value: d.description },
    {
      label: "Costo",
      value: d.cost != null ? formatMoney(d.cost) : "Sin costo",
    },
    ...rowIf("Odómetro", d.odometer_km != null ? kmText(d.odometer_km) : null),
    ...rowIf(
      "Próximo service",
      [
        d.next_service_date ? formatArgentineDate(d.next_service_date) : null,
        d.next_service_km != null ? kmText(d.next_service_km) : null,
      ]
        .filter(Boolean)
        .join(" o ") || null,
    ),
    ...rowIf("Proveedor", d.provider),
    ...rowIf("Notas", d.notes),
  ],
});

/** Keys of the display labels a liquidación draft carries (the client's id
 *  carries its name). */
export const FREIGHT_SETTLEMENT_LABELS = {
  total: "fs_total",
  unpriced: "fs_unpriced",
} as const;

export const freightSettlementProposalSpec = defineProposalSpec({
  title: "Armar liquidación de fletes",
  draft: FreightSettlementSaveSchema,
  fields: [{ key: "notes", label: "Notas", kind: "textarea" }],
  confirmLabel: "Guardar borrador",
  declineLabel: "Descartar",
  summarize: (d, labels) => {
    const unpriced = Number(labels[FREIGHT_SETTLEMENT_LABELS.unpriced] ?? 0);
    return [
      { label: "Cliente", value: labels[d.client_id] ?? d.client_id },
      {
        label: "Período",
        value: `${formatArgentineDate(d.period_start)} al ${formatArgentineDate(d.period_end)}`,
      },
      { label: "Cargas", value: String(d.shipment_ids.length) },
      ...rowIf("Total estimado", labels[FREIGHT_SETTLEMENT_LABELS.total]),
      ...(unpriced > 0
        ? [
            {
              label: PROPOSAL_WARNING_LABEL,
              value: `${unpriced} ${unpriced === 1 ? "carga entregada queda" : "cargas entregadas quedan"} afuera: no tienen flete ni tarifa de flete vigente.`,
            },
          ]
        : []),
      ...rowIf("Notas", d.notes),
      {
        label: "Qué pasa",
        value:
          "Queda en borrador en Liquidaciones de fletes, como al guardarla a mano: cada carga se valoriza al guardar. Confirmarla y facturarla se hace desde la liquidación.",
      },
    ];
  },
});

/** Keys of the labels a liquidación confirm carries (the client's id
 *  carries its name). */
export const FREIGHT_CONFIRM_LABELS = {
  period: "fsc_period",
  cargas: "fsc_cargas",
  savedTotal: "fsc_saved_total",
} as const;

export const freightSettlementConfirmProposalSpec = defineProposalSpec({
  title: "Confirmar liquidación de fletes",
  draft: FreightSettlementConfirmSchema,
  // Accepted as shown: the total is the server's, checked again on accept.
  fields: [],
  confirmLabel: "Confirmar y emitir remito R",
  declineLabel: "Descartar",
  summarize: (d, labels) => {
    const saved = labels[FREIGHT_CONFIRM_LABELS.savedTotal];
    return [
      ...rowIf("Cliente", labels[d.id]),
      ...rowIf("Período", labels[FREIGHT_CONFIRM_LABELS.period]),
      ...rowIf("Cargas", labels[FREIGHT_CONFIRM_LABELS.cargas]),
      { label: "Total", value: formatMoney(d.expected_total) },
      ...(saved
        ? [
            {
              label: PROPOSAL_WARNING_LABEL,
              value: `El borrador decía ${saved}: un flete o una tarifa cambió y se confirma al precio vigente.`,
            },
          ]
        : []),
      {
        label: "Qué pasa",
        value:
          "Se valoriza cada carga con su flete o la tarifa vigente, se emite el Remito R con su número y la liquidación ya no se edita, como al confirmarla a mano. Si el total cambia antes de aceptar, no se confirma. Facturarla se hace desde la liquidación.",
      },
    ];
  },
});

// ─── Storage billing ─────────────────────────────────────────────────────────

/** Keys of the labels a storage invoice carries (the client's id carries
 *  its name). */
export const STORAGE_INVOICE_LABELS = {
  channel: "si_channel",
  storage: "si_storage",
  loading: "si_loading",
  unloading: "si_unloading",
  pallets: "si_pallets",
} as const;

export const storageInvoiceProposalSpec = defineProposalSpec({
  title: "Facturar almacenaje",
  draft: StorageInvoiceProposalSchema,
  // Accepted as shown: the total is recomputed and compared on accept.
  fields: [],
  confirmLabel: "Facturar",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Cliente", value: labels[d.client_id] ?? d.client_id },
    {
      label: "Período",
      value: `${formatArgentineDate(d.period_start)} al ${formatArgentineDate(d.period_end)}`,
    },
    {
      label: "Canal",
      value: `${labels[STORAGE_INVOICE_LABELS.channel] ?? d.channel_id} · punto de venta ${d.punto_venta}`,
    },
    ...rowIf("Pallets", labels[STORAGE_INVOICE_LABELS.pallets]),
    ...rowIf("Almacenaje", labels[STORAGE_INVOICE_LABELS.storage]),
    ...rowIf("Carga", labels[STORAGE_INVOICE_LABELS.loading]),
    ...rowIf("Descarga", labels[STORAGE_INVOICE_LABELS.unloading]),
    { label: "Total neto", value: formatMoney(d.expected_total) },
    {
      label: "Qué pasa",
      value:
        "Se emite el comprobante del período (con CAE de AFIP en el canal fiscal, remito interno en el interno), más IVA 21%, y el período queda facturado para el cliente en ese canal, como con «Facturar» en Facturación de almacenaje. Si el almacenaje del período cambia antes de aceptar, no se emite.",
    },
  ],
});

// ─── Driver settlements ──────────────────────────────────────────────────────

/** Keys of the labels a rendición carries (the driver's, the accounts' and
 *  the cargas' ids carry their names). */
export const DRIVER_SETTLEMENT_LABELS = {
  expected: "ds_expected",
  drafts: "ds_drafts",
  settlement: "ds_settlement",
  driver: "ds_driver",
  date: "ds_date",
  cargas: "ds_cargas",
  difference: "ds_difference",
  employee: "ds_employee",
} as const;

/** Cargas listed one by one on a rendición card; past it, a count. */
const DRIVER_SETTLEMENT_ROWS = 10;

/** A rendición's difference as the Rendiciones page words it: what the
 *  driver handed in short (faltante) or over (sobrante); none when even. */
function differenceRows(difference: number, tail = ""): ProposalSummaryRow[] {
  if (!difference) return [];
  return [
    {
      label: difference < 0 ? "Faltante" : "Sobrante",
      value: `${formatMoney(Math.abs(difference))}${tail}`,
    },
  ];
}

export const driverSettlementProposalSpec = defineProposalSpec({
  title: "Armar rendición de chofer",
  draft: DriverSettlementSaveSchema,
  fields: [
    { key: "settlement_date", label: "Fecha", kind: "date" },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Guardar borrador",
  declineLabel: "Descartar",
  summarize: (d, labels) => {
    const received = d.items.reduce(
      (s, i) => s + i.lines.reduce((t, l) => t + l.amount, 0),
      0,
    );
    const expected = Number(labels[DRIVER_SETTLEMENT_LABELS.expected] ?? NaN);
    const byAccount = new Map<string, number>();
    for (const item of d.items) {
      for (const l of item.lines) {
        byAccount.set(
          l.account_id,
          (byAccount.get(l.account_id) ?? 0) + l.amount,
        );
      }
    }
    const drafts = Number(labels[DRIVER_SETTLEMENT_LABELS.drafts] ?? 0);
    const listed = d.items.length <= DRIVER_SETTLEMENT_ROWS;
    return [
      { label: "Chofer", value: labels[d.driver_id] ?? d.driver_id },
      { label: "Fecha", value: formatArgentineDate(d.settlement_date) },
      { label: "Cargas", value: String(d.items.length) },
      ...(listed
        ? d.items.map((item) => ({
            label: labels[item.shipment_id] ?? item.shipment_id,
            value: `entregó ${formatMoney(item.lines.reduce((t, l) => t + l.amount, 0))}`,
          }))
        : []),
      ...(Number.isFinite(expected)
        ? [{ label: "Tenía que cobrar", value: formatMoney(expected) }]
        : []),
      { label: "Entregó", value: formatMoney(received) },
      ...(Number.isFinite(expected)
        ? differenceRows(settlementDifference(expected, received))
        : []),
      ...[...byAccount].map(([id, amount]) => ({
        label: `En ${labels[id] ?? id}`,
        value: formatMoney(amount),
      })),
      ...(drafts > 0
        ? [
            {
              label: PROPOSAL_WARNING_LABEL,
              value: `El chofer ya tiene ${drafts === 1 ? "una rendición" : `${drafts} rendiciones`} en borrador.`,
            },
          ]
        : []),
      ...rowIf("Notas", d.notes),
      {
        label: "Qué pasa",
        value:
          "Queda en borrador en Rendiciones, como al guardarla a mano. Confirmarla genera los recibos.",
      },
    ];
  },
});

export const driverSettlementConfirmProposalSpec = defineProposalSpec({
  title: "Confirmar rendición de chofer",
  draft: DriverSettlementConfirmSchema,
  // Accepted as shown: the totals are the server's, checked again on accept.
  fields: [],
  confirmLabel: "Confirmar rendición",
  declineLabel: "Descartar",
  summarize: (d, labels) => {
    return [
      ...rowIf("Chofer", labels[DRIVER_SETTLEMENT_LABELS.driver]),
      ...rowIf("Fecha", labels[DRIVER_SETTLEMENT_LABELS.date]),
      ...rowIf("Cargas", labels[DRIVER_SETTLEMENT_LABELS.cargas]),
      { label: "Tenía que cobrar", value: formatMoney(d.expected_total) },
      { label: "Entregó", value: formatMoney(d.received_total) },
      ...differenceRows(
        settlementDifference(d.expected_total, d.received_total),
        ": después se resuelve si queda a cargo del chofer o del cliente.",
      ),
      {
        label: "Qué pasa",
        value:
          "Se genera un recibo por cliente y canal con lo que entregó, aplicado a la factura de cada carga, y la rendición ya no se edita, como al confirmarla a mano. Si cambia antes de aceptar, no se confirma.",
      },
    ];
  },
});

export const DIFFERENCE_CHARGED_TO_LABEL = {
  driver: "Chofer",
  client: "Cliente",
} as const satisfies Record<(typeof DIFFERENCE_CHARGED_TO)[number], string>;

export const driverSettlementDifferenceProposalSpec = defineProposalSpec({
  title: "Resolver diferencia de rendición",
  draft: DriverSettlementDifferenceSchema,
  // Accepted as shown: who bears it was asked and checked against the
  // user's permissions.
  fields: [],
  confirmLabel: "Asentar",
  declineLabel: "Descartar",
  summarize: (d, labels) => {
    const difference = Number(labels[DRIVER_SETTLEMENT_LABELS.difference] ?? 0);
    const amount = formatMoney(Math.abs(difference));
    const driver = labels[DRIVER_SETTLEMENT_LABELS.driver] ?? "el chofer";
    return [
      ...rowIf("Rendición", labels[DRIVER_SETTLEMENT_LABELS.settlement]),
      ...differenceRows(difference),
      { label: "A cargo de", value: DIFFERENCE_CHARGED_TO_LABEL[d.charged_to] },
      {
        label: "Qué pasa",
        value:
          d.charged_to === "driver"
            ? `Se emite un recibo que salda el faltante de ${amount} en la cuenta del cliente, y se carga como adelanto pagado con la caja en la cuenta corriente de ${driver}.`
            : difference < 0
              ? `El faltante de ${amount} queda abierto en la cuenta del cliente. No se toca la cuenta corriente del chofer.`
              : `El sobrante de ${amount} queda a cuenta del cliente. No se toca la cuenta corriente del chofer.`,
      },
    ];
  },
});

// ─── Clients ─────────────────────────────────────────────────────────────────

/** The contact and address fields the client form edits on both sides. */
const CLIENT_TEXT_FIELDS: readonly ProposalField[] = [
  { key: "legal_name", label: "Razón social / nombre", kind: "text" },
  { key: "display_name", label: "Nombre de fantasía", kind: "text" },
  { key: "email", label: "Email", kind: "text" },
  { key: "phone", label: "Teléfono", kind: "text" },
  { key: "address", label: "Domicilio fiscal", kind: "text" },
  { key: "real_address", label: "Domicilio real", kind: "text" },
  { key: "notes", label: "Notas", kind: "textarea" },
];

export const clientCreateProposalSpec = defineProposalSpec({
  title: "Dar de alta cliente",
  draft: ClientCreateSchema,
  fields: CLIENT_TEXT_FIELDS,
  confirmLabel: "Crear cliente",
  declineLabel: "Descartar",
  summarize: (d) => [
    {
      label: "Lado",
      value: d.is_fiscal
        ? "Ventas (factura con CAE)"
        : "Otras ventas (remito interno, sin CUIT)",
    },
    { label: "Razón social", value: d.legal_name },
    ...(d.is_fiscal
      ? [
          { label: "CUIT", value: d.cuit },
          {
            label: "Condición de IVA",
            value: IVA_CONDITION_LABEL[d.iva_condition],
          },
          ...rowIf("Domicilio fiscal", d.address),
        ]
      : []),
    ...rowIf("Nombre de fantasía", d.display_name),
    ...rowIf("Email", d.email),
    ...rowIf("Teléfono", d.phone),
    ...rowIf("Domicilio real", d.real_address),
    ...rowIf("Notas", d.notes),
  ],
});

/** A client's editable fields as the proposal saw them: the update is
 *  refused if any of them changed before the user accepts. */
export const ClientSnapshotSchema = z.object({
  is_fiscal: z.boolean(),
  cuit: z.string().nullable(),
  legal_name: z.string(),
  display_name: z.string().nullable(),
  iva_condition: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  real_address: z.string().nullable(),
  notes: z.string().nullable(),
});

export type ClientSnapshot = z.output<typeof ClientSnapshotSchema>;

export const CLIENT_SNAPSHOT_KEYS = ClientSnapshotSchema.keyof().options;

export const ClientUpdateDraftSchema = ClientUpdateSchema.extend({
  before: ClientSnapshotSchema,
});

const CLIENT_FIELD_LABEL: Record<string, string> = {
  cuit: "CUIT",
  iva_condition: "Condición de IVA",
  ...Object.fromEntries(CLIENT_TEXT_FIELDS.map((f) => [f.key, f.label])),
};

function clientFieldText(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (key === "iva_condition") return ivaConditionLabel(String(value)) ?? "—";
  return String(value);
}

/** The fields of an update draft whose value differs from the snapshot. */
export function changedClientFields(
  d: z.output<typeof ClientUpdateDraftSchema>,
): (keyof ClientSnapshot)[] {
  return CLIENT_SNAPSHOT_KEYS.filter((key) => {
    if (key === "is_fiscal") return false;
    const next: unknown = Reflect.get(d, key);
    return next !== undefined && (next ?? null) !== (d.before[key] ?? null);
  });
}

export const clientUpdateProposalSpec = defineProposalSpec({
  title: "Editar cliente",
  draft: ClientUpdateDraftSchema,
  fields: CLIENT_TEXT_FIELDS,
  confirmLabel: "Guardar cambios",
  declineLabel: "Descartar",
  summarize: (d) => {
    const changed = changedClientFields(d);
    return [
      { label: "Cliente", value: d.before.legal_name },
      ...(changed.length === 0
        ? [{ label: "Cambios", value: "Ninguno: queda igual." }]
        : changed.map((key) => ({
            label: CLIENT_FIELD_LABEL[key] ?? key,
            value: `${clientFieldText(key, d.before[key])} → ${clientFieldText(key, Reflect.get(d, key))}`,
          }))),
      {
        label: "Qué pasa",
        value:
          "Se guarda como al editar la ficha del cliente. Si alguien lo modificó mientras tanto, no se guarda.",
      },
    ];
  },
});

// ─── Comprobantes ────────────────────────────────────────────────────────────

/** Keys of the display labels a comprobante draft carries. */
export const COMPROBANTE_LABELS = {
  client: "client",
  channel: "channel",
  origin: "origin",
  invoice: "invoice",
} as const;

function comprobanteRows(
  d: z.output<typeof CreateComprobanteSchema>,
  labels: ProposalLabels,
): ProposalSummaryRow[] {
  // Only a fiscal comprobante carries a letter (the action resolves it).
  const isFiscal = d.letter !== null;
  const currency = d.moneda === MONEDA.PESOS ? "ARS" : "USD";
  const totals = computeTotals(d.items, isFiscal);
  const kind = invoiceKindLabel(d.kind, isFiscal);
  return [
    {
      label: "Cliente",
      value: labels[COMPROBANTE_LABELS.client] ?? d.client_id,
    },
    {
      label: "Comprobante",
      value: d.kind === "factura" && d.letter ? `${kind} ${d.letter}` : kind,
    },
    ...rowIf("Sobre", labels[COMPROBANTE_LABELS.origin]),
    {
      label: "Canal",
      value: labels[COMPROBANTE_LABELS.channel] ?? d.channel_id,
    },
    { label: "Punto de venta", value: String(d.punto_venta) },
    { label: "Fecha", value: formatArgentineDate(d.fecha) },
    ...d.items.map((it) => {
      const line = computeLineAmounts(it, isFiscal);
      const iva =
        isFiscal && it.iva_rate_id !== null
          ? ` + IVA ${String(ivaRatePercent(it.iva_rate_id)).replace(".", ",")} %`
          : "";
      const qty = Number.isInteger(it.quantity)
        ? formatInteger(it.quantity)
        : formatRate(it.quantity);
      return {
        label: it.description,
        value: `${qty} ×${formatMoney(it.unit_price, currency)} = ${formatMoney(line.line_neto, currency)}${iva}`,
      };
    }),
    ...(isFiscal
      ? [
          { label: "Neto", value: formatMoney(totals.imp_neto, currency) },
          { label: "IVA", value: formatMoney(totals.imp_iva, currency) },
        ]
      : []),
    { label: "Total", value: formatMoney(totals.imp_total, currency) },
    ...(currency !== "ARS"
      ? [{ label: "Cotización", value: `$ ${formatRate(d.cotizacion)}` }]
      : []),
    ...rowIf("Motivo", d.motivo_nc_nd),
    ...rowIf("Observaciones (internas)", d.notes),
    {
      label: "Qué pasa",
      value: isFiscal
        ? "Al aceptar se emite como desde Comprobantes: va a AFIP y queda con CAE (o con el error de AFIP para reintentar)."
        : "Al aceptar se guarda como desde Comprobantes, con número interno y sin AFIP.",
    },
  ];
}

export const invoiceProposalSpec = defineProposalSpec({
  title: "Emitir comprobante",
  draft: CreateComprobanteSchema,
  fields: [
    { key: "notes", label: "Observaciones (internas)", kind: "textarea" },
  ],
  confirmLabel: "Emitir",
  declineLabel: "Descartar",
  summarize: comprobanteRows,
});

export const creditDebitNoteProposalSpec = defineProposalSpec({
  title: "Emitir nota de crédito o débito",
  draft: CreateComprobanteSchema,
  fields: [
    { key: "motivo_nc_nd", label: "Motivo", kind: "text" },
    { key: "notes", label: "Observaciones (internas)", kind: "textarea" },
  ],
  confirmLabel: "Emitir nota",
  declineLabel: "Descartar",
  summarize: comprobanteRows,
});

export const invoiceEmailProposalSpec = defineProposalSpec({
  title: "Enviar comprobante por email",
  draft: SendInvoiceEmailSchema,
  fields: [
    { key: "recipient", label: "Para", kind: "text" },
    { key: "subject", label: "Asunto", kind: "text" },
    { key: "body", label: "Mensaje", kind: "textarea" },
  ],
  confirmLabel: "Enviar",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    {
      label: "Comprobante",
      value: labels[COMPROBANTE_LABELS.invoice] ?? d.invoice_id,
    },
    ...rowIf("Cliente", labels[COMPROBANTE_LABELS.client]),
    { label: "Para", value: d.recipient },
    { label: "Asunto", value: d.subject },
    ...rowIf("Mensaje", d.body),
    {
      label: "Qué pasa",
      value:
        "Se manda el PDF como con «Enviar por email» y queda registrado en el comprobante.",
    },
  ],
});

export const receiptEmailProposalSpec = defineProposalSpec({
  title: "Enviar recibo por email",
  draft: SendReceiptEmailSchema,
  fields: [
    { key: "recipient", label: "Para", kind: "text" },
    { key: "subject", label: "Asunto", kind: "text" },
    { key: "body", label: "Mensaje", kind: "textarea" },
  ],
  confirmLabel: "Enviar",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Recibo", value: labels[d.receipt_id] ?? d.receipt_id },
    ...rowIf("Cliente", labels[COMPROBANTE_LABELS.client]),
    { label: "Para", value: d.recipient },
    { label: "Asunto", value: d.subject },
    ...rowIf("Mensaje", d.body),
    {
      label: "Qué pasa",
      value:
        "Se manda el PDF como con «Enviar por email» y queda registrado en el recibo.",
    },
  ],
});

// ─── Treasury ────────────────────────────────────────────────────────────────

export const cashMovementProposalSpec = defineProposalSpec({
  title: "Registrar movimiento de caja",
  draft: TransactionCreateSchema,
  fields: [
    { key: "amount", label: "Monto", kind: "number" },
    { key: "transaction_date", label: "Fecha", kind: "date" },
    { key: "description", label: "Descripción", kind: "textarea" },
  ],
  confirmLabel: "Registrar movimiento",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Tipo", value: TRANSACTION_KIND_LABEL[d.kind] },
    { label: "Cuenta", value: labels[d.account_id] ?? d.account_id },
    { label: "Canal", value: labels[d.channel_id] ?? d.channel_id },
    { label: "Monto", value: formatMoney(d.amount, d.currency) },
    { label: "Fecha", value: formatArgentineDate(d.transaction_date) },
    {
      label: "Mes devengado",
      value: formatPeriod(d.accrual_month.slice(0, 7)),
    },
    ...(d.description ? [{ label: "Descripción", value: d.description }] : []),
    {
      label: "Qué pasa",
      value:
        "Se registra como en Caja › Nuevo movimiento y se asienta solo. Un período cerrado no se toca.",
    },
  ],
});

export const transferProposalSpec = defineProposalSpec({
  title: "Registrar transferencia entre cuentas",
  draft: TransferCreateSchema,
  fields: [
    { key: "amount", label: "Monto", kind: "number" },
    { key: "transaction_date", label: "Fecha", kind: "date" },
    { key: "description", label: "Descripción", kind: "textarea" },
  ],
  confirmLabel: "Registrar transferencia",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Sale de", value: labels[d.account_from_id] ?? d.account_from_id },
    { label: "Entra en", value: labels[d.account_to_id] ?? d.account_to_id },
    { label: "Canal", value: labels[d.channel_id] ?? d.channel_id },
    { label: "Monto", value: formatMoney(d.amount, d.currency) },
    { label: "Fecha", value: formatArgentineDate(d.transaction_date) },
    {
      label: "Mes devengado",
      value: formatPeriod(d.accrual_month.slice(0, 7)),
    },
    ...(d.description ? [{ label: "Descripción", value: d.description }] : []),
  ],
});

/** A payer's total, payment lines, allocations and what stays «a cuenta», as
 *  summary rows (a receipt and a payment order read the same). */
function payerRows(
  d: {
    total_amount: number;
    currency: string;
    cotizacion?: number | null;
    payment_lines: readonly { amount: number; reference?: string | null }[];
  },
  lineAccounts: readonly string[],
  allocations: readonly { id: string; amount: number }[],
  labels: ProposalLabels,
  lineLabel: string,
): ProposalSummaryRow[] {
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  const aCuenta = Math.round((d.total_amount - allocated) * 100) / 100;
  return [
    { label: "Total", value: formatMoney(d.total_amount, d.currency) },
    ...(d.cotizacion
      ? [{ label: "Cotización", value: `$ ${formatRate(d.cotizacion)}` }]
      : []),
    ...d.payment_lines.map((l, i) => {
      const account = lineAccounts[i] ?? "";
      return {
        label: `${lineLabel} ${labels[account] ?? account}`.trim(),
        value: `${formatMoney(l.amount, d.currency)}${l.reference ? ` · ${l.reference}` : ""}`,
      };
    }),
    ...allocations.map((a) => ({
      label: `Imputa a ${labels[a.id] ?? a.id}`,
      value: formatMoney(a.amount, d.currency),
    })),
    ...(aCuenta > 0.005
      ? [{ label: "Queda a cuenta", value: formatMoney(aCuenta, d.currency) }]
      : []),
  ];
}

export const receiptProposalSpec = defineProposalSpec({
  title: "Registrar cobro",
  draft: ReceiptCreateSchema,
  fields: [
    { key: "receipt_date", label: "Fecha", kind: "date" },
    { key: "numero", label: "Número de recibo", kind: "number", decimals: 0 },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Emitir recibo",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Cliente", value: labels[d.client_id] ?? d.client_id },
    { label: "Canal", value: labels[d.channel_id] ?? d.channel_id },
    { label: "Recibo Nº", value: String(d.numero) },
    { label: "Fecha", value: formatArgentineDate(d.receipt_date) },
    ...payerRows(
      d,
      d.payment_lines.map((l) => l.account_id),
      d.allocations.map((a) => ({
        id: a.invoice_id ?? a.rejected_check_id ?? "",
        amount: a.amount_applied,
      })),
      labels,
      "Cobrado en",
    ),
    ...d.payment_lines.flatMap((l) =>
      l.check
        ? [
            {
              label: "Cheque",
              value: `${l.check.bank_name ?? ""} · librador ${l.check.drawer_name ?? ""} · se cobra el ${formatArgentineDate(l.check.due_date)}`,
            },
          ]
        : [],
    ),
    ...d.retentions.map((r) => ({
      label: `${RETENTION_KIND_LABEL[r.kind]} ${RETENTION_TAX_TYPE_LABEL[r.tax_type]}${r.jurisdiction ? ` ${r.jurisdiction}` : ""}`,
      value: `${formatMoney(r.amount, d.currency)} · cert. ${r.certificate_number} del ${formatArgentineDate(r.certificate_date)}`,
    })),
    ...(d.notes ? [{ label: "Notas", value: d.notes }] : []),
    {
      label: "Qué pasa",
      value:
        "Se emite el recibo como en Recibos › Nuevo recibo: la plata entra en la cuenta, las retenciones quedan con su certificado, se imputa a esos comprobantes y se asienta. Si alguno ya no tiene ese saldo pendiente, no se emite.",
    },
  ],
});

export const paymentOrderProposalSpec = defineProposalSpec({
  title: "Crear orden de pago",
  draft: PaymentOrderCreateSchema,
  fields: [
    { key: "payment_date", label: "Fecha", kind: "date" },
    { key: "numero", label: "Número de orden", kind: "number", decimals: 0 },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Emitir orden de pago",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Proveedor", value: labels[d.supplier_id] ?? d.supplier_id },
    { label: "Canal", value: labels[d.channel_id] ?? d.channel_id },
    { label: "Orden Nº", value: String(d.numero) },
    { label: "Fecha", value: formatArgentineDate(d.payment_date) },
    ...payerRows(
      d,
      d.payment_lines.map((l) =>
        l.line_kind === "endorse_check" ? l.endorsed_check_id : l.account_id,
      ),
      d.allocations.map((a) => ({
        id: a.purchase_invoice_id,
        amount: a.amount_applied,
      })),
      labels,
      "Pagado desde",
    ),
    ...d.payment_lines.flatMap((l) =>
      l.line_kind === "issue_check"
        ? [
            {
              label: `Cheque propio Nº ${l.issued_check.check_number}`,
              value: `${ISSUED_CHECK_KIND_LABEL[l.issued_check.kind]} · ${l.issued_check.bank_name} · vence el ${formatArgentineDate(l.issued_check.due_date)}${l.issued_check.beneficiary_name ? ` · a ${l.issued_check.beneficiary_name}` : ""}`,
            },
          ]
        : [],
    ),
    ...(d.notes ? [{ label: "Notas", value: d.notes }] : []),
    {
      label: "Qué pasa",
      value:
        "Se emite la orden de pago como en Órdenes de pago › Nueva: la plata sale de la cuenta, los cheques endosados salen de la cartera, los propios quedan emitidos, se imputa a esas facturas y se asienta. Si alguna ya no tiene ese saldo pendiente o un cheque ya no está en cartera, no se emite.",
    },
  ],
});

// ─── Cheques ─────────────────────────────────────────────────────────────────

export const manualCheckProposalSpec = defineProposalSpec({
  title: "Cargar cheque recibido",
  draft: ManualChequeCreateSchema,
  fields: [
    { key: "check_number", label: "Número", kind: "text" },
    { key: "bank_name", label: "Banco", kind: "text" },
    { key: "drawer_name", label: "Firmante", kind: "text" },
    { key: "amount", label: "Monto", kind: "number" },
    { key: "issue_date", label: "Emisión", kind: "date" },
    { key: "due_date", label: "Fecha de cobro", kind: "date" },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Cargar cheque",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Tipo", value: CHECK_KIND_LABEL[d.kind] },
    { label: "Número", value: d.check_number },
    { label: "Banco", value: d.bank_name },
    {
      label: "Firmante",
      value: d.drawer_cuit
        ? `${d.drawer_name} (${d.drawer_cuit})`
        : d.drawer_name,
    },
    { label: "Monto", value: formatMoney(d.amount, d.currency) },
    { label: "Emisión", value: formatArgentineDate(d.issue_date) },
    { label: "Fecha de cobro", value: formatArgentineDate(d.due_date) },
    {
      label: "Cartera",
      value: labels[d.cartera_account_id] ?? d.cartera_account_id,
    },
    { label: "Canal", value: labels[d.channel_id] ?? d.channel_id },
    ...(d.source_client_id
      ? [
          {
            label: "Lo dio",
            value: labels[d.source_client_id] ?? d.source_client_id,
          },
        ]
      : []),
    ...(d.notes ? [{ label: "Notas", value: d.notes }] : []),
    {
      label: "Qué pasa",
      value:
        "Entra a la cartera como en Cheques › Nuevo cheque, sin recibo: para que cancele deuda de un cliente, registrá el cobro con el cheque.",
    },
  ],
});

/** Key of the label that describes the deposited check. */
export const DEPOSIT_CHECK_LABEL = "check";

export const checkDepositProposalSpec = defineProposalSpec({
  title: "Depositar cheque",
  draft: DepositChequeSchema,
  fields: [
    { key: "event_date", label: "Fecha", kind: "date" },
    { key: "description", label: "Descripción", kind: "textarea" },
  ],
  confirmLabel: "Depositar",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Cheque", value: labels[DEPOSIT_CHECK_LABEL] ?? d.check_id },
    { label: "Se deposita en", value: labels[d.account_id] ?? d.account_id },
    { label: "Canal", value: labels[d.channel_id] ?? d.channel_id },
    { label: "Fecha", value: formatArgentineDate(d.event_date) },
    ...(d.description ? [{ label: "Descripción", value: d.description }] : []),
    {
      label: "Qué pasa",
      value:
        "Sale de la cartera y entra en la cuenta, como «Depositar» en Cheques. Si el cheque ya no está en cartera, no se deposita.",
    },
  ],
});

export const issuedCheckProposalSpec = defineProposalSpec({
  title: "Emitir cheque propio",
  draft: IssuedCheckCreateSchema,
  fields: [
    { key: "check_number", label: "Número", kind: "text" },
    { key: "bank_name", label: "Banco", kind: "text" },
    { key: "beneficiary_name", label: "Beneficiario", kind: "text" },
    { key: "amount", label: "Monto", kind: "number" },
    { key: "issue_date", label: "Emisión", kind: "date" },
    { key: "due_date", label: "Vencimiento", kind: "date" },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Cargar cheque",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Tipo", value: ISSUED_CHECK_KIND_LABEL[d.kind] },
    { label: "Número", value: d.check_number },
    { label: "Banco", value: d.bank_name },
    { label: "Cuenta", value: labels[d.bank_account_id] ?? d.bank_account_id },
    {
      label: "Beneficiario",
      value:
        (d.supplier_id ? labels[d.supplier_id] : null) ??
        d.beneficiary_name ??
        "—",
    },
    { label: "Monto", value: formatMoney(d.amount, d.currency) },
    { label: "Emisión", value: formatArgentineDate(d.issue_date) },
    { label: "Vencimiento", value: formatArgentineDate(d.due_date) },
    { label: "Canal", value: labels[d.channel_id] ?? d.channel_id },
    ...(d.notes ? [{ label: "Notas", value: d.notes }] : []),
    {
      label: "Qué pasa",
      value:
        "Queda emitido como en Cheques propios › Nuevo: el banco se mueve cuando se marca cobrado. Para pagarle a un proveedor con este cheque, armá la orden de pago en la pantalla.",
    },
  ],
});

// ─── Purchases ───────────────────────────────────────────────────────────────

/** Keys of the display labels a purchase draft carries (the supplier,
 *  channel, account, center and origin ids carry their own). */
export const PURCHASE_LABELS = {
  /** "1" when the channel is internal (remito interno, not a factura). */
  internal: "purchase_internal",
  /** What the server suggested and the user should check. */
  warning: "purchase_warning",
  /** The ARCA gap, formatted in the voucher's currency. */
  gap: "arca_gap",
} as const;

type PurchaseDraft = z.output<typeof PurchaseInvoiceCreateSchema>;

function purchaseNumber(d: PurchaseDraft): string {
  const pv = String(d.punto_venta).padStart(5, "0");
  const nu = String(d.numero).padStart(8, "0");
  return `${d.letter ? `${d.letter} ` : ""}${pv}-${nu}`;
}

/** A purchase draft as the card's rows: what the purchase form would save. */
function purchaseRows(
  d: PurchaseDraft,
  labels: ProposalLabels,
): ProposalSummaryRow[] {
  const currency = d.moneda === "PES" ? "ARS" : "USD";
  const money = (n: number) => formatMoney(n, currency);
  const internal = labels[PURCHASE_LABELS.internal] === "1";
  const split = PURCHASE_TRIBUTE_FIELDS.filter((f) => d[f] > 0).map(
    (f) => `${PURCHASE_TRIBUTE_LABEL[f]} ${money(d[f])}`,
  );
  const warning = labels[PURCHASE_LABELS.warning];
  return [
    { label: "Proveedor", value: labels[d.supplier_id] ?? d.supplier_id },
    { label: "Canal", value: labels[d.channel_id] ?? d.channel_id },
    {
      label: "Comprobante",
      value: `${purchaseKindLabel(d.kind, internal)} ${purchaseNumber(d)}`,
    },
    ...(d.invoice_origin_id
      ? [
          {
            label: "Comprobante de origen",
            value: labels[d.invoice_origin_id] ?? d.invoice_origin_id,
          },
        ]
      : []),
    ...(d.motivo_nc_nd ? [{ label: "Motivo", value: d.motivo_nc_nd }] : []),
    { label: "Fecha", value: formatArgentineDate(d.fecha) },
    {
      label: "Vencimiento de pago",
      value: d.fch_vto_pago
        ? formatArgentineDate(d.fch_vto_pago)
        : "Sin vencimiento",
    },
    { label: "Neto", value: money(d.imp_neto) },
    ...(d.imp_no_gravado > 0
      ? [{ label: "No gravado", value: money(d.imp_no_gravado) }]
      : []),
    ...(d.imp_op_exentas > 0
      ? [{ label: "Exento", value: money(d.imp_op_exentas) }]
      : []),
    { label: "IVA", value: money(d.imp_iva) },
    ...(d.imp_trib > 0
      ? [
          {
            label: "Otros tributos",
            value: `${money(d.imp_trib)}${split.length ? ` (${split.join(" · ")})` : ""}`,
          },
        ]
      : []),
    { label: "Total", value: money(d.imp_total) },
    ...(d.moneda !== "PES"
      ? [{ label: "Cotización", value: `$ ${formatRate(d.cotizacion)}` }]
      : []),
    ...(d.cae_proveedor ? [{ label: "CAE", value: d.cae_proveedor }] : []),
    {
      label: "Cuenta de gasto",
      value: d.account_id
        ? (labels[d.account_id] ?? d.account_id)
        : d.kind === "factura"
          ? "Compras (sin cuenta propia)"
          : "La del comprobante de origen",
    },
    ...(d.cost_center_id
      ? [
          {
            label: "Centro de costo",
            value: labels[d.cost_center_id] ?? d.cost_center_id,
          },
        ]
      : []),
    ...(d.notes ? [{ label: "Notas", value: d.notes }] : []),
    ...(warning ? [{ label: PROPOSAL_WARNING_LABEL, value: warning }] : []),
  ];
}

export const purchaseInvoiceProposalSpec = defineProposalSpec({
  title: "Cargar factura de compra",
  draft: PurchaseInvoiceCreateSchema,
  fields: [
    { key: "fecha", label: "Fecha", kind: "date" },
    { key: "fch_vto_pago", label: "Vencimiento de pago", kind: "date" },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Cargar factura",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    ...purchaseRows(d, labels),
    {
      label: "Qué pasa",
      value:
        "Se carga como en Compras › Nueva factura: queda el asiento y la deuda con el proveedor. Si ya está cargada, no se duplica.",
    },
  ],
});

export const ArcaPurchaseDraftSchema = z.object({
  voucher_id: z.string().uuid(),
  /** Where ARCA's total above its parts goes: the user's choice, never the
   *  model's; null when the parts add up. */
  gap_target: z.enum(ARCA_GAP_TARGETS).nullable(),
  invoice: PurchaseInvoiceCreateSchema,
});

export const arcaPurchaseProposalSpec = defineProposalSpec({
  title: "Cargar comprobante de ARCA",
  draft: ArcaPurchaseDraftSchema,
  // Identity and amounts are ARCA's, and the gap's destination moves the
  // amounts: a change goes back through the assistant, which redrafts it.
  fields: [],
  confirmLabel: "Cargar comprobante",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    ...purchaseRows(d.invoice, labels),
    ...(d.gap_target
      ? [
          {
            label: "Diferencia de ARCA",
            value: `${labels[PURCHASE_LABELS.gap] ?? "—"} → ${arcaGapTargetLabel(d.gap_target, d.invoice.letter ?? null)} (lo elegiste vos)`,
          },
        ]
      : []),
    {
      label: "Qué pasa",
      value:
        "Se carga como al aceptarlo en Compras › ARCA: el número, la fecha, el CAE y los importes son los de ARCA. Si alguien ya la cargó a mano, queda vinculada; si ARCA cambió, no se carga.",
    },
  ],
});

/** Keys of the display labels a supplier draft carries; the category,
 *  account, center and channel ids carry their own. A supplier edit stores
 *  each changed field's value before under `before:<field>`. */
export const SUPPLIER_LABELS = {
  supplier: "supplier",
  before: (field: string) => `before:${field}`,
} as const;

const SUPPLIER_FIELD_LABEL: Record<string, string> = {
  cuit: "CUIT",
  legal_name: "Razón social",
  display_name: "Nombre de fantasía",
  iva_condition: "Condición de IVA",
  email: "Email",
  phone: "Teléfono",
  address: "Domicilio fiscal",
  real_address: "Domicilio real",
  notes: "Notas",
  default_channel_id: "Canal por defecto",
  default_payment_term_days: "Plazo de pago",
  category_id: "Categoría",
  default_expense_account_id: "Cuenta de gasto por defecto",
  default_cost_center_id: "Centro de costo por defecto",
};

/** Field values that are ids show their label; the rest, as they read. */
function supplierValue(
  field: string,
  value: unknown,
  labels: ProposalLabels,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "iva_condition" && isIvaCondition(value)) {
    return IVA_CONDITION_LABEL[value];
  }
  if (field === "default_payment_term_days") return `${String(value)} días`;
  const text = String(value);
  return labels[text] ?? text;
}

const SUPPLIER_TEXT_FIELDS = [
  "display_name",
  "email",
  "phone",
  "address",
  "real_address",
  "default_payment_term_days",
  "category_id",
  "default_expense_account_id",
  "default_cost_center_id",
  "default_channel_id",
  "notes",
] as const;

export const supplierProposalSpec = defineProposalSpec({
  title: "Dar de alta proveedor",
  draft: SupplierCreateSchema,
  fields: [
    { key: "legal_name", label: "Razón social", kind: "text" },
    { key: "display_name", label: "Nombre de fantasía", kind: "text" },
    { key: "email", label: "Email", kind: "text" },
    { key: "phone", label: "Teléfono", kind: "text" },
    { key: "real_address", label: "Domicilio real", kind: "text" },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Crear proveedor",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    {
      label: "Tipo",
      value: d.is_fiscal
        ? "Compras (con CUIT, factura fiscal)"
        : "Otras compras (sin CUIT)",
    },
    { label: d.is_fiscal ? "Razón social" : "Nombre", value: d.legal_name },
    ...(d.is_fiscal
      ? [
          { label: "CUIT", value: d.cuit },
          {
            label: "Condición de IVA",
            value: IVA_CONDITION_LABEL[d.iva_condition],
          },
        ]
      : []),
    ...SUPPLIER_TEXT_FIELDS.flatMap((field) => {
      const value: unknown = Reflect.get(d, field);
      return value === null || value === undefined
        ? []
        : [
            {
              label: SUPPLIER_FIELD_LABEL[field] ?? field,
              value: supplierValue(field, value, labels),
            },
          ];
    }),
  ],
});

export const supplierUpdateProposalSpec = defineProposalSpec({
  title: "Editar proveedor",
  draft: SupplierUpdateSchema,
  // Only what the user asked to change travels in the draft: a change goes
  // back through the assistant.
  fields: [],
  confirmLabel: "Guardar cambios",
  declineLabel: "Descartar",
  summarize: (d, labels) => {
    const { id, ...rest } = d;
    return [
      {
        label: "Proveedor",
        value: labels[SUPPLIER_LABELS.supplier] ?? id,
      },
      ...Object.entries(rest)
        .filter(([, value]) => value !== undefined)
        .map(([field, value]) => ({
          label: SUPPLIER_FIELD_LABEL[field] ?? field,
          value: `${labels[SUPPLIER_LABELS.before(field)] ?? "—"} → ${supplierValue(field, value, labels)}`,
        })),
    ];
  },
});

// ─── Impuestos ───────────────────────────────────────────────────────────────

/** Keys of the display labels a tax payment draft carries (the document and
 *  the cash or bank account ids carry their own). */
export const TAX_PAYMENT_LABELS = {
  /** The chart account the payment debits. */
  ledger: "tax_ledger_account",
  due: "tax_due",
} as const;

export const taxDocumentProposalSpec = defineProposalSpec({
  title: "Cargar impuesto",
  draft: TaxDocumentCreateSchema,
  fields: [
    { key: "due_date", label: "Vence", kind: "date" },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Cargar impuesto",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Impuesto", value: taxDocumentLabel(d) },
    { label: "Tipo", value: TAX_KIND_LABEL[d.kind] },
    { label: "Período", value: formatPeriod(d.period) },
    { label: "Vence", value: formatArgentineDate(d.due_date) },
    {
      label: "Importe",
      value:
        d.amount === null
          ? "Sin importe todavía"
          : `${formatMoney(d.amount)}${d.amount_is_estimate ? " (estimado)" : ""}`,
    },
    ...(d.credit_balance !== null
      ? [
          {
            label: "Saldo a favor técnico",
            value: formatMoney(d.credit_balance),
          },
        ]
      : []),
    {
      label: "Cuenta contable",
      value: d.account_id
        ? (labels[d.account_id] ?? d.account_id)
        : "Sin cuenta (hace falta para pagarlo)",
    },
    ...(d.notes ? [{ label: "Notas", value: d.notes }] : []),
  ],
});

export const taxPaymentProposalSpec = defineProposalSpec({
  title: "Pagar impuesto",
  draft: PayTaxDocumentSchema,
  fields: [
    { key: "paid_date", label: "Fecha de pago", kind: "date" },
    { key: "amount", label: "Importe", kind: "number" },
  ],
  confirmLabel: "Registrar pago",
  declineLabel: "Descartar",
  summarize: (d, labels) => {
    const due = labels[TAX_PAYMENT_LABELS.due];
    return [
      { label: "Impuesto", value: labels[d.id] ?? d.id },
      ...(due ? [{ label: "Vence", value: due }] : []),
      { label: "Importe", value: formatMoney(d.amount) },
      { label: "Fecha de pago", value: formatArgentineDate(d.paid_date) },
      { label: "Pagado desde", value: labels[d.account_id] ?? d.account_id },
      {
        label: "Cuenta contable",
        value: labels[TAX_PAYMENT_LABELS.ledger] ?? "La del impuesto",
      },
      {
        label: "Qué pasa",
        value:
          "Como «Pagar» en Impuestos: queda el egreso en Caja contra la cuenta del impuesto y el impuesto pasa a pagado. Si ya estaba pagado, no se registra de nuevo.",
      },
    ];
  },
});

// ─── Employees ───────────────────────────────────────────────────────────────

/** The employee columns a proposal card shows, in the form's order. */
const EMPLOYEE_SUMMARY_FIELDS = [
  ["legal_name", "Apellido y nombre"],
  ["position", "Puesto"],
  ["cuil", "CUIL"],
  ["cbu", "CBU"],
  ["pay_frequency", "Frecuencia de pago"],
  ["base_salary", "Sueldo base"],
  ["viatico_monthly", "Viático mensual"],
  ["is_monotributo", "Monotributista"],
  ["hire_date", "Ingreso"],
  ["convenio", "Convenio"],
  ["categoria", "Categoría"],
  ["obra_social", "Obra social"],
  ["art", "ART"],
  ["retribucion_formal", "Retribución formal"],
  ["license_number", "Licencia de conducir"],
  ["license_category", "Categoría de licencia"],
  ["driver_phone", "Teléfono del chofer"],
  ["notes", "Notas"],
] as const;

type EmployeeSummaryKey = (typeof EMPLOYEE_SUMMARY_FIELDS)[number][0];

const EMPLOYEE_MONEY_KEYS: ReadonlySet<string> = new Set([
  "base_salary",
  "viatico_monthly",
  "retribucion_formal",
]);

/** An employee field as the card shows it ("—" when empty). */
export function employeeFieldText(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") {
    return EMPLOYEE_MONEY_KEYS.has(key) ? formatMoney(value) : String(value);
  }
  if (typeof value !== "string") return "—";
  if (key === "hire_date") return formatArgentineDate(value);
  if (key === "pay_frequency" && isPayFrequency(value)) {
    return PAY_FREQUENCY_LABEL[value];
  }
  return value;
}

/** The label that carries an employee field as it was before the edit. */
export function employeeBeforeLabel(key: string): string {
  return `before.${key}`;
}

const employeeEditableFields: readonly ProposalField[] = [
  { key: "legal_name", label: "Apellido y nombre", kind: "text" },
  {
    key: "position",
    label: "Puesto",
    kind: "select",
    options: EMPLOYEE_POSITIONS.map((p) => ({ value: p, label: p })),
  },
  { key: "cuil", label: "CUIL", kind: "text" },
  { key: "cbu", label: "CBU", kind: "text" },
  {
    key: "pay_frequency",
    label: "Frecuencia de pago",
    kind: "select",
    options: PAY_FREQUENCIES.map((f) => ({
      value: f,
      label: PAY_FREQUENCY_LABEL[f],
    })),
  },
  { key: "base_salary", label: "Sueldo base", kind: "number" },
  { key: "viatico_monthly", label: "Viático mensual", kind: "number" },
  { key: "hire_date", label: "Ingreso", kind: "date" },
  { key: "notes", label: "Notas", kind: "textarea" },
];

/** Shown even when empty: the card says the salary or position is missing. */
const ALWAYS_SHOWN: ReadonlySet<string> = new Set(["position", "base_salary"]);

export const createEmployeeProposalSpec = defineProposalSpec({
  title: "Dar de alta un empleado",
  draft: EmployeeCreateSchema,
  fields: employeeEditableFields,
  confirmLabel: "Crear empleado",
  declineLabel: "Descartar",
  summarize: (d) => [
    ...EMPLOYEE_SUMMARY_FIELDS.flatMap(([key, label]) => {
      const text = employeeFieldText(key, d[key]);
      return text === "—" && !ALWAYS_SHOWN.has(key)
        ? []
        : [{ label, value: text }];
    }),
    ...(d.vacation_current_days != null
      ? [
          {
            label: "Vacaciones del período en curso",
            value: `${d.vacation_current_days} días`,
          },
        ]
      : []),
    ...(d.vacation_previous_days != null
      ? [
          {
            label: "Vacaciones de años anteriores",
            value: `${d.vacation_previous_days} días`,
          },
        ]
      : []),
    ...(isDriverPosition(d.position)
      ? [
          {
            label: "Qué pasa",
            value: "Como es chofer, también queda en Flota → Choferes.",
          },
        ]
      : []),
  ],
});

/** The fields of an edit draft that differ from the employee before it. */
export function changedEmployeeFields(
  draft: Record<string, unknown>,
  labels: ProposalLabels,
): EmployeeSummaryKey[] {
  return EMPLOYEE_SUMMARY_FIELDS.map(([key]) => key).filter(
    (key) =>
      key in draft &&
      employeeFieldText(key, draft[key]) !==
        (labels[employeeBeforeLabel(key)] ?? "—"),
  );
}

export const updateEmployeeProposalSpec = defineProposalSpec({
  title: "Editar empleado",
  draft: EmployeeUpdateSchema,
  fields: employeeEditableFields,
  confirmLabel: "Guardar cambios",
  declineLabel: "Descartar",
  summarize: (d, labels) => {
    const changed = changedEmployeeFields(d, labels);
    return [
      { label: "Empleado", value: labels[d.id] ?? d.id },
      ...(changed.length
        ? changed.map((key) => ({
            label: EMPLOYEE_SUMMARY_FIELDS.find(([k]) => k === key)?.[1] ?? key,
            value: `${labels[employeeBeforeLabel(key)] ?? "—"} → ${employeeFieldText(key, d[key])}`,
          }))
        : [{ label: "Cambios", value: "Ninguno: queda igual." }]),
    ];
  },
});

// ─── Payroll payments ────────────────────────────────────────────────────────

/** Keys of the display labels a payroll payment draft carries (the ids of
 *  the entries, the account and the channel carry their own). */
export const PAYROLL_PAYMENT_LABELS = { period: "period" } as const;

export const payrollPaymentProposalSpec = defineProposalSpec({
  title: "Pagar sueldos",
  draft: BulkCreatePayrollPaymentsSchema,
  fields: [
    { key: "paid_at", label: "Fecha de pago", kind: "date" },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Registrar pago",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    {
      label: "Período",
      value: labels[PAYROLL_PAYMENT_LABELS.period] ?? "—",
    },
    { label: "Cuenta", value: labels[d.account_id] ?? d.account_id },
    { label: "Canal", value: labels[d.channel_id] ?? d.channel_id },
    { label: "Método", value: PAYROLL_PAYMENT_METHOD_LABEL[d.method] },
    { label: "Fecha", value: formatArgentineDate(d.paid_at) },
    ...d.items.map((i) => ({
      label: labels[i.entry_id] ?? i.entry_id,
      value: formatMoney(i.amount),
    })),
    ...(d.items.length > 1
      ? [
          {
            label: "Total",
            value: formatMoney(d.items.reduce((s, i) => s + i.amount, 0)),
          },
        ]
      : []),
    ...(d.notes ? [{ label: "Notas", value: d.notes }] : []),
    {
      label: "Qué pasa",
      value:
        d.items.length > 1
          ? "Se registran todos los pagos juntos, como el Pago masivo de la planilla: cada uno con su egreso en Caja. Si alguno supera el saldo pendiente, no se registra ninguno."
          : "Se registra el pago como en la planilla, con su egreso en Caja. Si supera el saldo pendiente, no se registra.",
    },
  ],
});

// ─── Employee account ────────────────────────────────────────────────────────

/** Keys of the display labels an employee account draft carries (the
 *  employee, account and channel ids carry their own). */
export const EMPLOYEE_ACCOUNT_LABELS = { currency: "currency" } as const;

const CASH_KIND_LABEL = {
  advance: "Adelanto al empleado",
  payment: "Pago del empleado",
} as const;

export const employeeAccountCashProposalSpec = defineProposalSpec({
  title: "Movimiento de caja del empleado",
  draft: RecordAccountCashSchema,
  fields: [
    { key: "date", label: "Fecha", kind: "date" },
    { key: "amount", label: "Importe", kind: "number" },
    { key: "description", label: "Descripción", kind: "textarea" },
  ],
  confirmLabel: "Registrar",
  declineLabel: "Descartar",
  summarize: (d, labels) => {
    const currency = labels[EMPLOYEE_ACCOUNT_LABELS.currency] ?? "ARS";
    return [
      { label: "Empleado", value: labels[d.employee_id] ?? d.employee_id },
      { label: "Tipo", value: CASH_KIND_LABEL[d.kind] },
      { label: "Cuenta", value: labels[d.account_id] ?? d.account_id },
      { label: "Canal", value: labels[d.channel_id] ?? d.channel_id },
      { label: "Fecha", value: formatArgentineDate(d.date) },
      { label: "Importe", value: formatMoney(d.amount, currency) },
      ...(d.kind === "advance"
        ? [
            {
              label: "Descuento en planilla",
              value:
                d.installment_amount != null
                  ? `Plan en cuotas de ${formatMoney(d.installment_amount, currency)}`
                  : "Sin plan: queda como deuda en la cuenta corriente",
            },
          ]
        : []),
      ...(d.plan_id
        ? [{ label: "Imputa al plan", value: labels[d.plan_id] ?? d.plan_id }]
        : []),
      ...(d.description
        ? [{ label: "Descripción", value: d.description }]
        : []),
      {
        label: "Qué pasa",
        value:
          d.kind === "advance"
            ? "Sale la plata de la cuenta (egreso en Caja) y el adelanto queda en la cuenta corriente del empleado, como en su ficha."
            : "Entra la plata a la cuenta (ingreso en Caja) y el pago baja la deuda en la cuenta corriente del empleado, como en su ficha.",
      },
    ];
  },
});

export const employeeAccountMovementProposalSpec = defineProposalSpec({
  title: "Movimiento en la cuenta del empleado",
  draft: CreateManualMovementSchema,
  fields: [
    { key: "movement_date", label: "Fecha", kind: "date" },
    { key: "amount", label: "Importe", kind: "number" },
    { key: "description", label: "Descripción", kind: "text" },
  ],
  confirmLabel: "Cargar movimiento",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Empleado", value: labels[d.employee_id] ?? d.employee_id },
    { label: "Tipo", value: ACCOUNT_MOVEMENT_KIND_LABEL[d.kind] },
    { label: "Fecha", value: formatArgentineDate(d.movement_date) },
    { label: "Importe", value: formatMoney(d.amount, d.currency) },
    { label: "A favor de", value: CREDITOR_LABEL[d.creditor] },
    ...(d.plan_id
      ? [{ label: "Plan", value: labels[d.plan_id] ?? d.plan_id }]
      : []),
    { label: "Descripción", value: d.description },
    {
      label: "Qué pasa",
      value:
        "Solo la cuenta corriente del empleado: no mueve Caja ni bancos, como «Cargo / pago manual» en su ficha.",
    },
  ],
});

// ─── Attendance ──────────────────────────────────────────────────────────────

/** Keys of the display labels an attendance draft carries. */
export const ATTENDANCE_LABELS = {
  /** What the day had loaded by hand before, which the proposal replaces. */
  before: "before",
} as const;

export const attendanceProposalSpec = defineProposalSpec({
  title: "Cargar asistencia",
  draft: UpsertAttendanceSchema,
  fields: [
    { key: "date", label: "Día", kind: "date" },
    {
      key: "kind",
      label: "Novedad",
      kind: "select",
      options: ATTENDANCE_KINDS.map((k) => ({
        value: k,
        label: ATTENDANCE_KIND_LABEL[k],
      })),
    },
    { key: "notes", label: "Notas", kind: "textarea" },
  ],
  confirmLabel: "Cargar asistencia",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Empleado", value: labels[d.employee_id] ?? d.employee_id },
    { label: "Día", value: formatArgentineDate(d.date) },
    { label: "Novedad", value: ATTENDANCE_KIND_LABEL[d.kind] },
    ...(d.hours_lost != null
      ? [{ label: "Horas perdidas", value: String(d.hours_lost) }]
      : []),
    ...(d.notes ? [{ label: "Notas", value: d.notes }] : []),
    ...(labels[ATTENDANCE_LABELS.before]
      ? [
          {
            label: "Reemplaza",
            value: `${labels[ATTENDANCE_LABELS.before]}, cargado a mano ese día`,
          },
        ]
      : []),
    {
      label: "Qué pasa",
      value:
        "Queda en la grilla de Asistencia como si la cargaras a mano. Un día que viene de una licencia o un feriado no se pisa: se cambia desde su origen.",
    },
  ],
});

// ─── Loans ───────────────────────────────────────────────────────────────────

/** Keys of the display labels a loan installment draft carries (the
 *  installment and account ids carry their own). */
export const LOAN_INSTALLMENT_LABELS = {
  loan: "loan",
  currency: "currency",
} as const;

export const loanInstallmentPaymentProposalSpec = defineProposalSpec({
  title: "Pagar cuota de préstamo",
  draft: PayInstallmentSchema,
  fields: [{ key: "paid_date", label: "Fecha de pago", kind: "date" }],
  confirmLabel: "Registrar pago",
  declineLabel: "Descartar",
  summarize: (d, labels) => [
    { label: "Préstamo", value: labels[LOAN_INSTALLMENT_LABELS.loan] ?? "—" },
    { label: "Cuota", value: labels[d.id] ?? d.id },
    {
      label: "Monto",
      value: formatMoney(d.amount, labels[LOAN_INSTALLMENT_LABELS.currency]),
    },
    { label: "Cuenta", value: labels[d.account_id] ?? d.account_id },
    { label: "Fecha de pago", value: formatArgentineDate(d.paid_date) },
    {
      label: "Qué pasa",
      value:
        "Se registra el egreso en Caja en el canal del préstamo, como «Pagar cuota»; después de la última, el préstamo queda cancelado. Una cuota que ya se pagó no se paga dos veces.",
    },
  ],
});

/** Every proposal action's spec, by the action (tool) name. */
export const PROPOSAL_SPECS: Readonly<Record<string, ProposalSpec>> = {
  proposeLeave: leaveProposalSpec,
  proposeJournalEntry: journalEntryProposalSpec,
  proposeExchangeRate: exchangeRateProposalSpec,
  proposeAiWorkflow: workflowProposalSpec,
  proposeDocumentScan: documentScanProposalSpec,
  proposeTask: taskProposalSpec,
  proposeClientTariff: clientTariffProposalSpec,
  proposeBankMatches: bankMatchesProposalSpec,
  proposeLateInterestNd: lateInterestNdProposalSpec,
  proposeRecategorizeExpense: recategorizeExpenseProposalSpec,
  proposeTrip: tripProposalSpec,
  proposeShipment: shipmentProposalSpec,
  proposeShipmentStatus: shipmentStatusProposalSpec,
  proposeFuelLoad: fuelLoadProposalSpec,
  proposeMaintenance: maintenanceProposalSpec,
  proposeFreightSettlement: freightSettlementProposalSpec,
  proposeFreightSettlementConfirm: freightSettlementConfirmProposalSpec,
  proposeStorageInvoice: storageInvoiceProposalSpec,
  proposeDriverSettlement: driverSettlementProposalSpec,
  proposeDriverSettlementConfirm: driverSettlementConfirmProposalSpec,
  proposeDriverSettlementDifference: driverSettlementDifferenceProposalSpec,
  proposeClient: clientCreateProposalSpec,
  proposeClientUpdate: clientUpdateProposalSpec,
  proposeInvoice: invoiceProposalSpec,
  proposeCreditDebitNote: creditDebitNoteProposalSpec,
  proposeInvoiceEmail: invoiceEmailProposalSpec,
  proposeReceiptEmail: receiptEmailProposalSpec,
  proposeCashMovement: cashMovementProposalSpec,
  proposeTransfer: transferProposalSpec,
  proposeReceipt: receiptProposalSpec,
  proposePaymentOrder: paymentOrderProposalSpec,
  proposeManualCheck: manualCheckProposalSpec,
  proposeCheckDeposit: checkDepositProposalSpec,
  proposeIssuedCheck: issuedCheckProposalSpec,
  proposePurchaseInvoice: purchaseInvoiceProposalSpec,
  proposeArcaPurchase: arcaPurchaseProposalSpec,
  proposeSupplier: supplierProposalSpec,
  proposeSupplierUpdate: supplierUpdateProposalSpec,
  proposeTaxDocument: taxDocumentProposalSpec,
  proposeTaxPayment: taxPaymentProposalSpec,
  proposeCreateEmployee: createEmployeeProposalSpec,
  proposeUpdateEmployee: updateEmployeeProposalSpec,
  proposePayrollPayment: payrollPaymentProposalSpec,
  proposeEmployeeAccountCash: employeeAccountCashProposalSpec,
  proposeEmployeeAccountMovement: employeeAccountMovementProposalSpec,
  proposeAttendance: attendanceProposalSpec,
  proposeLoanInstallmentPayment: loanInstallmentPaymentProposalSpec,
};
