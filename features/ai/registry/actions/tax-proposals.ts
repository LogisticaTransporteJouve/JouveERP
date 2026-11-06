import { z } from "zod";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { isoDate } from "@/features/exchange-rates/schema";
import {
  listTaxAccountOptionsAction,
  listTaxDocumentsAction,
  type TaxAccountOption,
} from "@/features/taxes/actions/tax-documents-actions";
import {
  TAX_KIND_DEFAULT_ROLE,
  TAX_KINDS,
  isOpenTaxStatus,
  taxDocumentLabel,
  type TaxDocument,
} from "@/features/taxes/schema";
import { createTaxDocument } from "@/lib/commands/create-tax-document";
import { payTaxDocument } from "@/lib/commands/pay-tax-document";
import { formatArgentineDate, formatPeriod, todayInAR } from "@/lib/format";
import { PeriodSchema } from "@/lib/validation/common";

import {
  TAX_PAYMENT_LABELS,
  taxDocumentProposalSpec,
  taxPaymentProposalSpec,
} from "../../lib/proposal-specs";
import { defineAiProposal, type AiPrepareResult } from "../propose";

import { MAX_CANDIDATES, norm } from "./resolve-client";

// Impuestos: load an obligation, and pay one, as the Impuestos page does.
// The amounts are the user's (or the document's), never the model's.

const amount = z.number().finite().positive().max(999_999_999_999.99);

function ask(
  field: string,
  message: string,
  options?: { value: string; label: string }[],
): AiPrepareResult {
  return {
    kind: "issues",
    issues: [{ field, message }],
    ...(options?.length
      ? { candidates: [{ field, options: options.slice(0, MAX_CANDIDATES) }] }
      : {}),
  };
}

/** One of `options` by exact label (or code), or the single one containing
 *  what the user said. */
function pickByLabel<T extends { label: string }>(
  said: string,
  options: readonly T[],
): { pick: T } | { close: T[] } {
  const q = norm(said);
  const exact = options.filter(
    (o) => norm(o.label) === q || norm(o.label).startsWith(`${q} `),
  );
  const close = options.filter((o) => norm(o.label).includes(q));
  const pick =
    exact.length === 1 ? exact[0] : close.length === 1 ? close[0] : undefined;
  return pick ? { pick } : { close };
}

// ─── Cargar impuesto ─────────────────────────────────────────────────────────

export const proposeTaxDocument = defineAiProposal({
  name: "proposeTaxDocument",
  domain: "contabilidad",
  permission: ["taxes:write", "taxes:read"],
  sources: ["tax_documents", "chart_of_accounts"],
  description:
    "Propose loading a tax obligation (Impuestos: IVA, IIBB, anticipo de " +
    "Ganancias, SICORE, F931, monotributo or another one) with its period " +
    "(YYYY-MM) and due date, for the user to accept on a card. The amount " +
    "only if the user gave it (amount_is_estimate when they said it is an " +
    "estimate); never compute it yourself. The chart account the payment " +
    "debits by code or name (default: the kind's usual one). A duplicate of " +
    "the same kind and period is refused. Writes nothing by itself.",
  input: z.object({
    kind: z.enum(TAX_KINDS),
    title: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe("Name of an 'otro' tax."),
    jurisdiction: z
      .string()
      .trim()
      .max(60)
      .optional()
      .describe("For IIBB or a municipal tax, e.g. 'Buenos Aires'."),
    period: PeriodSchema,
    due_date: isoDate,
    amount: amount.optional(),
    amount_is_estimate: z.boolean().optional(),
    account: z.string().trim().min(1).max(120).optional(),
    credit_balance: amount
      .optional()
      .describe("IVA only: saldo a favor técnico the DDJJ leaves."),
    notes: z.string().trim().max(1000).optional(),
  }),
  spec: taxDocumentProposalSpec,
  prepare: async (_ctx, input) => {
    const res = await listTaxAccountOptionsAction();
    if (!res.ok) return { kind: "error", error: res.error };
    const options = res.data;
    let account: TaxAccountOption | undefined;
    if (input.account !== undefined) {
      const found = pickByLabel(input.account, options);
      if (!("pick" in found)) {
        return ask(
          "account",
          found.close.length === 0
            ? `No hay una cuenta contable para impuestos que coincida con "${input.account}".`
            : `"${input.account}" coincide con varias cuentas.`,
          (found.close.length ? found.close : options).map((o) => ({
            value: o.label,
            label: o.label,
          })),
        );
      }
      account = found.pick;
    } else {
      const role = TAX_KIND_DEFAULT_ROLE[input.kind];
      account = role ? options.find((o) => o.system_role === role) : undefined;
    }
    return {
      kind: "draft",
      draft: {
        kind: input.kind,
        title: input.title ?? null,
        jurisdiction: input.jurisdiction ?? null,
        period: input.period,
        due_date: input.due_date,
        amount: input.amount ?? null,
        amount_is_estimate: input.amount_is_estimate ?? false,
        account_id: account?.id ?? null,
        credit_balance: input.credit_balance ?? null,
        notes: input.notes ?? null,
      },
      labels: account ? { [account.id]: account.label } : {},
    };
  },
  execute: (ctx, draft) => createTaxDocument(ctx.userId, draft),
});

// ─── Pagar impuesto ──────────────────────────────────────────────────────────

export const proposeTaxPayment = defineAiProposal({
  name: "proposeTaxPayment",
  domain: "contabilidad",
  // «Pagar» books a Caja outflow (taxes:write + transactions:write); the
  // document and the cash or bank accounts are read too.
  permission: [
    "taxes:write",
    "transactions:write",
    "taxes:read",
    "accounts:read",
  ],
  sources: ["tax_documents", "accounts", "transactions"],
  description:
    "Propose paying an open tax obligation (tax_document_id from " +
    "getTaxDocuments) from a cash or bank account in pesos (by name), for " +
    "the user to accept on a card: it books the outflow in Caja against the " +
    "tax's account, as «Pagar» in Impuestos. The amount is the document's " +
    "unless the user said another; paid_date defaults to today. Writes " +
    "nothing by itself.",
  input: z.object({
    tax_document_id: z.string().uuid(),
    period: PeriodSchema.optional().describe(
      "The document's period (YYYY-MM), when known: finds it faster.",
    ),
    account: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Cash or bank account it is paid from, as the user said it."),
    paid_date: isoDate.optional(),
    amount: amount.optional(),
  }),
  spec: taxPaymentProposalSpec,
  prepare: async (_ctx, input) => {
    const today = todayInAR();
    // A year's list carries that year's documents plus every open earlier one.
    const years = [
      ...new Set(
        [input.period ?? today, today].map((p) => Number(p.slice(0, 4))),
      ),
    ];
    let found: TaxDocument | undefined;
    for (const year of years) {
      const list = await listTaxDocumentsAction({ year });
      if (!list.ok) return { kind: "error", error: list.error };
      found = list.data.find((d) => d.id === input.tax_document_id);
      if (found) break;
    }
    if (!found) {
      return { kind: "error", error: "No encontramos ese impuesto." };
    }
    if (!isOpenTaxStatus(found.status)) {
      return {
        kind: "error",
        error:
          found.status === "pagado"
            ? "Ese impuesto ya está pagado."
            : "Ese impuesto está anulado.",
      };
    }
    if (found.account_id === null) {
      return {
        kind: "error",
        error:
          "Al impuesto le falta la cuenta contable: cargala en Impuestos antes de pagarlo.",
      };
    }
    const value = input.amount ?? found.amount;
    if (value === null) {
      return ask(
        "amount",
        "El impuesto todavía no tiene importe: decime cuánto se paga.",
      );
    }

    const accounts = await listAccountsAction();
    if (!accounts.ok) return { kind: "error", error: accounts.error };
    // Taxes are paid in pesos from a cash or bank account (the page's list).
    const payable = accounts.data
      .filter(
        (a) =>
          a.is_active &&
          a.currency === "ARS" &&
          a.type !== "checks" &&
          a.type !== "echeq",
      )
      .map((a) => ({ id: a.id, label: a.name }));
    const from = pickByLabel(input.account, payable);
    if (!("pick" in from)) {
      return ask(
        "account",
        from.close.length === 0
          ? `No hay una cuenta de caja o banco en pesos que coincida con "${input.account}".`
          : `"${input.account}" coincide con varias cuentas.`,
        (from.close.length ? from.close : payable).map((a) => ({
          value: a.label,
          label: a.label,
        })),
      );
    }

    return {
      kind: "draft",
      draft: {
        id: found.id,
        paid_date: input.paid_date ?? today,
        account_id: from.pick.id,
        amount: value,
      },
      labels: {
        [found.id]: `${taxDocumentLabel(found)} · ${formatPeriod(found.period)}`,
        [from.pick.id]: from.pick.label,
        [TAX_PAYMENT_LABELS.due]: formatArgentineDate(found.due_date),
        ...(found.account_name
          ? { [TAX_PAYMENT_LABELS.ledger]: found.account_name }
          : {}),
      },
    };
  },
  execute: async (ctx, draft) => {
    const res = await payTaxDocument(ctx.userId, draft);
    return res.ok ? { ok: true, data: { id: draft.id } } : res;
  },
});
