import { z } from "zod";

import { getReconciliationAction } from "@/features/bank-reconciliation/actions/reconciliation-actions";
import {
  CLIENT_TARIFF_CONCEPTS,
  CLIENT_TARIFF_CURRENCIES,
  CLIENT_TARIFF_UNITS,
  UNITS_BY_CONCEPT,
} from "@/features/client-tariffs/schema";
import { isoDate } from "@/features/exchange-rates/schema";
import { issueFiscalInvoiceAction } from "@/features/invoices/actions/invoices-actions";
import { listLateInterestCandidatesAction } from "@/features/late-interest/actions/late-interest-actions";
import {
  comprobanteLabel,
  computeLateInterest,
} from "@/features/late-interest/lib/late-interest";
import { MONEDA } from "@/lib/afip/codes";
import { createClientTariff } from "@/lib/commands/create-client-tariff";
import { createTask } from "@/lib/commands/create-task";
import { issueLateInterestNd } from "@/lib/commands/issue-late-interest-nd";
import { matchBankLines } from "@/lib/commands/match-bank-line";
import { formatArgentineDate, formatMoney, todayInAR } from "@/lib/format";
import { ScopeInputSchema } from "@/lib/validation/common";

import {
  LATE_INTEREST_LABELS,
  MAX_PROPOSED_MATCHES,
  bankMatchesProposalSpec,
  clientTariffProposalSpec,
  lateInterestNdProposalSpec,
  taskProposalSpec,
} from "../../lib/proposal-specs";
import { defineAiAction } from "../define";
import { defineAiProposal } from "../propose";
import { errResult, money, okResult } from "../result";
import { readScope } from "../scope";

import { MAX_CANDIDATES, resolveClient } from "./resolve-client";
import { findReconciliationAccount } from "./treasury";

// 6.3 proposals over existing writes. Each `prepare` resolves names with the
// feature's read actions (their gate + RLS); the write runs only after the
// user accepts, through the lib/commands function the feature's own server
// action calls (the late-interest ND through issueFiscalInvoiceAction, the
// documented cross-feature write).

function short(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** AFIP's currency code on a comprobante → the app's. */
function currencyOf(moneda: string): "ARS" | "USD" {
  return moneda === MONEDA.PESOS ? "ARS" : "USD";
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const proposeTask = defineAiProposal({
  name: "proposeTask",
  domain: "general",
  permission: ["tasks:write", "tasks:read"],
  sources: ["tasks", "task_assignees"],
  description:
    "Propose creating a team task (Tareas) for the user to accept on a card: " +
    "title, optional description and due date (YYYY-MM-DD). Assigned to the " +
    "user unless assign_to_me is false. Writes nothing by itself.",
  input: z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    due_date: isoDate.optional(),
    assign_to_me: z.boolean().optional(),
  }),
  spec: taskProposalSpec,
  prepare: async (ctx, input) => {
    const mine = input.assign_to_me ?? true;
    return {
      kind: "draft",
      draft: {
        title: input.title,
        description: input.description ?? null,
        due_date: input.due_date ?? null,
        assignee_ids: mine ? [ctx.userId] : [],
      },
      labels: mine ? { [ctx.userId]: "Vos" } : {},
    };
  },
  execute: (ctx, draft) => createTask(ctx.userId, draft),
});

// ─── Client tariffs ──────────────────────────────────────────────────────────

export const proposeClientTariff = defineAiProposal({
  name: "proposeClientTariff",
  domain: "deposito",
  permission: ["storage_billing:issue", "storage_billing:read", "clients:read"],
  sources: ["clients", "client_tariffs"],
  description:
    "Propose loading a client's tariff (tarifario: almacenaje, carga, " +
    "descarga or flete) for the user to accept on a card. The overlap guard " +
    "refuses a tariff whose vigencia crosses another one of the same concept. " +
    "Writes nothing by itself.",
  input: z.object({
    client: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .describe("Client name or CUIT, as the user said it."),
    concept: z.enum(CLIENT_TARIFF_CONCEPTS),
    unit: z
      .enum(CLIENT_TARIFF_UNITS)
      .optional()
      .describe(
        "storage: pallet_month or pallet_day; handling_in/out: pallet; freight: shipment.",
      ),
    price: z.number().finite().min(0).max(999_999_999_999.99),
    currency: z.enum(CLIENT_TARIFF_CURRENCIES).optional(),
    valid_from: isoDate,
    valid_to: isoDate.optional(),
    notes: z.string().trim().max(500).optional(),
  }),
  spec: clientTariffProposalSpec,
  prepare: async (_ctx, input) => {
    const units = UNITS_BY_CONCEPT[input.concept];
    const unit = input.unit ?? (units.length === 1 ? units[0] : undefined);
    if (!unit) {
      return {
        kind: "issues",
        issues: [
          {
            field: "unit",
            message:
              "Falta la unidad: por pallet por mes o por pallet por día.",
          },
        ],
        candidates: [
          {
            field: "unit",
            options: [
              { value: "pallet_month", label: "Por pallet por mes" },
              { value: "pallet_day", label: "Por pallet por día" },
            ],
          },
        ],
      };
    }
    const found = await resolveClient(input.client);
    if (!found.ok) return found.result;
    const pick = found.client;
    return {
      kind: "draft",
      draft: {
        client_id: pick.id,
        concept: input.concept,
        unit,
        price: input.price,
        currency: input.currency ?? "ARS",
        valid_from: input.valid_from,
        valid_to: input.valid_to ?? null,
        notes: input.notes ?? null,
        area_id: null,
      },
      labels: { [pick.id]: pick.legal_name },
    };
  },
  execute: (ctx, draft) => createClientTariff(ctx.userId, draft),
});

// ─── Bank reconciliation ─────────────────────────────────────────────────────

export const proposeBankMatches = defineAiProposal({
  name: "proposeBankMatches",
  domain: "tesoreria",
  permission: ["transactions:write", "transactions:read"],
  sources: ["bank_statement_lines", "bank_statement_matches", "transactions"],
  description:
    "Propose reconciling the bank statement of a treasury account for a " +
    "period with the matches the reconciliation page suggests (same amount, " +
    "close date, reference), for the user to accept on a card. Writes " +
    "nothing by itself; never invents a match.",
  input: z.object({
    account: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Treasury account name, as the user said it."),
    from: isoDate,
    to: isoDate,
  }),
  spec: bankMatchesProposalSpec,
  prepare: async (_ctx, input) => {
    const found = await findReconciliationAccount(input.account);
    if (!found.ok && found.options.length === 0) {
      return { kind: "error", error: found.error };
    }
    if (!found.ok) {
      return {
        kind: "issues",
        issues: [{ field: "account", message: found.error }],
        candidates: [
          {
            field: "account",
            options: found.options
              .slice(0, MAX_CANDIDATES)
              .map((a) => ({ value: a.name, label: a.name })),
          },
        ],
      };
    }
    const { account } = found;
    const view = await getReconciliationAction({
      account_id: account.id,
      from: input.from,
      to: input.to,
    });
    if (!view.ok) return { kind: "error", error: view.error };
    const lines = new Map(view.data.lines.map((l) => [l.id, l]));
    const movements = new Map(view.data.movements.map((m) => [m.id, m]));
    const suggestions = view.data.suggestions.slice(0, MAX_PROPOSED_MATCHES);
    if (suggestions.length === 0) {
      return {
        kind: "error",
        error:
          "No hay sugerencias de conciliación para esa cuenta y período: las líneas pendientes se concilian a mano en Conciliación.",
      };
    }
    const labels: Record<string, string> = { [account.id]: account.name };
    for (const s of suggestions) {
      const line = lines.get(s.line_id);
      const mov = movements.get(s.transaction_id);
      if (line) {
        labels[line.id] =
          `${formatArgentineDate(line.line_date)} · ${short(line.description)} · ${formatMoney(line.amount, account.currency)}`;
      }
      if (mov) {
        labels[mov.id] =
          `${formatArgentineDate(mov.transaction_date)} ${short(mov.description ?? "Movimiento")}`;
      }
    }
    return {
      kind: "draft",
      draft: {
        account_id: account.id,
        matches: suggestions.map((s) => ({
          line_id: s.line_id,
          transaction_ids: [s.transaction_id],
        })),
      },
      labels,
    };
  },
  execute: async (ctx, draft) => {
    const res = await matchBankLines(ctx.userId, draft.matches);
    if (res.matched === 0) {
      return {
        ok: false,
        error: res.failed[0]?.error ?? "No se pudo conciliar ninguna línea.",
      };
    }
    return {
      ok: true,
      data: {
        id: draft.account_id,
        note:
          res.failed.length > 0
            ? `${res.matched} conciliadas; ${res.failed.length} salteadas porque cambiaron.`
            : `${res.matched} conciliadas.`,
      },
    };
  },
});

// ─── Late interest ───────────────────────────────────────────────────────────

/** Overdue comprobantes with the interest their next ND would charge (the
 *  late-interest page's list). */
export const getLateInterestCandidates = defineAiAction({
  name: "getLateInterestCandidates",
  domain: "ventas",
  permission: "invoices:read",
  sideEffect: "read",
  sources: ["late_interest_candidates", "late_interest_charges"],
  description:
    "Overdue comprobantes with open balance and the late interest (interés " +
    "por mora) not charged yet: client, comprobante, due date, open amount, " +
    "monthly rate (the client's or the general one; null = none set), days " +
    "and interest to charge, largest first. For 'cuánta mora no cobré'.",
  input: z.object({
    as_of: isoDate.optional().describe("Charge up to this day; default today."),
    scope: ScopeInputSchema,
    limit: z.number().int().min(1).max(100).optional(),
  }),
  run: async (_ctx, input) => {
    const { isFiscal, label } = readScope(input.scope);
    const asOf = input.as_of ?? todayInAR();
    const res = await listLateInterestCandidatesAction({
      as_of: asOf,
      isFiscal,
    });
    if (!res.ok) return errResult(res.error);
    const rows = [...res.data].sort((a, b) => b.interest - a.interest);
    const limit = input.limit ?? 50;
    const withRate = rows.filter((r) => r.monthly_rate !== null);
    const total = withRate.reduce((s, r) => s + r.interest, 0);
    return okResult(
      `${label}: ${rows.length} overdue comprobantes as of ${asOf}; ` +
        `${rows.length - withRate.length} without a rate; uncharged interest ${money(total)} ` +
        "(each in its comprobante's currency).",
      {
        as_of: asOf,
        rows: rows.slice(0, limit).map((r) => ({
          invoice_id: r.invoice_id,
          client_name: r.client_name,
          comprobante: comprobanteLabel(r),
          due_date: r.due_date,
          currency: currencyOf(r.moneda),
          open_amount: r.open_amount,
          charge_from: r.charge_from,
          monthly_rate_pct: r.monthly_rate,
          days_count: r.days,
          interest: r.interest,
        })),
      },
      { partial: rows.length > limit },
    );
  },
});

export const proposeLateInterestNd = defineAiProposal({
  name: "proposeLateInterestNd",
  domain: "ventas",
  permission: ["invoices:issue", "credit_debit_notes:issue", "invoices:read"],
  sources: ["late_interest_candidates", "late_interest_charges"],
  description:
    "Propose issuing the late-interest debit note (ND por mora) of one " +
    "overdue comprobante (invoice_id from getLateInterestCandidates), up to " +
    "as_of (default today), at the client's or general monthly rate unless " +
    "the user gave one. The card shows the amount; nothing is issued until " +
    "the user accepts it.",
  input: z.object({
    invoice_id: z.string().uuid(),
    as_of: isoDate.optional(),
    monthly_rate: z.number().positive().max(100).optional(),
    punto_venta: z.number().int().min(1).max(99999).optional(),
  }),
  spec: lateInterestNdProposalSpec,
  prepare: async (_ctx, input) => {
    const asOf = input.as_of ?? todayInAR();
    const res = await listLateInterestCandidatesAction({ as_of: asOf });
    if (!res.ok) return { kind: "error", error: res.error };
    const c = res.data.find((r) => r.invoice_id === input.invoice_id);
    if (!c) {
      return {
        kind: "error",
        error: "El comprobante no está vencido o no tiene saldo abierto.",
      };
    }
    const rate = input.monthly_rate ?? c.monthly_rate;
    if (rate === null) {
      return {
        kind: "issues",
        issues: [
          {
            field: "monthly_rate",
            message:
              "No hay tasa de mora cargada (ni del cliente ni la general): pedile al usuario la tasa mensual.",
          },
        ],
      };
    }
    const { days, interest } = computeLateInterest({
      balanceDays: c.balance_days,
      monthlyRate: rate,
      from: c.charge_from,
      to: asOf,
    });
    if (days === 0) {
      return {
        kind: "error",
        error: "Ya se cobraron los intereses hasta esa fecha.",
      };
    }
    if (interest <= 0) {
      return {
        kind: "error",
        error: "El interés da cero: no hay nada que cobrar.",
      };
    }
    const currency = currencyOf(c.moneda);
    return {
      kind: "draft",
      draft: {
        invoice_id: c.invoice_id,
        as_of: asOf,
        monthly_rate: rate,
        punto_venta: input.punto_venta ?? c.punto_venta,
        expected_interest: interest,
      },
      labels: {
        [LATE_INTEREST_LABELS.client]: c.client_name,
        [LATE_INTEREST_LABELS.comprobante]: `${comprobanteLabel(c)} (venció el ${formatArgentineDate(c.due_date)})`,
        [LATE_INTEREST_LABELS.base]: formatMoney(c.open_amount, currency),
        [LATE_INTEREST_LABELS.period]: `${formatArgentineDate(c.charge_from)} al ${formatArgentineDate(asOf)} (${days} días)`,
        [LATE_INTEREST_LABELS.interest]: formatMoney(interest, currency),
      },
    };
  },
  execute: async (ctx, draft) => {
    const { expected_interest, ...input } = draft;
    const res = await issueLateInterestNd(
      ctx.userId,
      input,
      issueFiscalInvoiceAction,
      expected_interest,
    );
    return res.ok ? { ok: true, data: { id: res.data.invoiceId } } : res;
  },
});
