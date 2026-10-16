import { z } from "zod";

import { ExchangeRateCreateSchema } from "@/features/exchange-rates/schema";
import {
  CreateLeaveSchema,
  LEAVE_KIND_LABEL,
  LEAVE_KINDS,
} from "@/features/hr/vacation-schema";
import { ManualJournalEntryCreateSchema } from "@/features/journal-entries/schema";
import {
  amountToInput,
  formatAmountInput,
  formatArgentineDate,
  formatMoney,
  formatRate,
  parseArAmount,
} from "@/lib/format";

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
  summarize: (d) => [
    { label: "Fecha", value: formatArgentineDate(d.rate_date) },
    { label: "Cotización", value: `$ ${formatRate(d.rate)}` },
    { label: "Fuente", value: "Manual (reemplaza la del BCRA de ese día)" },
    ...(d.notes ? [{ label: "Notas", value: d.notes }] : []),
  ],
});

/** Every proposal action's spec, by the action (tool) name. */
export const PROPOSAL_SPECS: Readonly<Record<string, ProposalSpec>> = {
  proposeLeave: leaveProposalSpec,
  proposeJournalEntry: journalEntryProposalSpec,
  proposeExchangeRate: exchangeRateProposalSpec,
};
