import { z } from "zod";

import { MatchLineSchema } from "@/features/bank-reconciliation/schema";
import {
  CLIENT_TARIFF_CONCEPT_LABELS,
  CLIENT_TARIFF_UNIT_LABELS,
  ClientTariffCreateSchema,
} from "@/features/client-tariffs/schema";
import {
  RecategorizeExpenseSchema,
  type ExpenseSource,
} from "@/features/cost-centers/schema";
import {
  rateJumpWarningFor,
  type RateReference,
} from "@/features/exchange-rates/lib/rate-jump";
import { ExchangeRateCreateSchema } from "@/features/exchange-rates/schema";
import {
  CreateLeaveSchema,
  LEAVE_KIND_LABEL,
  LEAVE_KINDS,
} from "@/features/hr/vacation-schema";
import { ManualJournalEntryCreateSchema } from "@/features/journal-entries/schema";
import { IssueLateInterestSchema } from "@/features/late-interest/schema";
import { TaskCreateSchema } from "@/features/tasks/schema";
import {
  amountToInput,
  formatAmountInput,
  formatArgentineDate,
  formatMoney,
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

function inclusiveDays(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
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
      value: String(inclusiveDays(d.start_date, d.end_date)),
    },
    ...(d.notes ? [{ label: "Notas", value: d.notes }] : []),
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
      label: "Atención",
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
  return warning ? { label: "Atención", value: warning } : null;
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
};
