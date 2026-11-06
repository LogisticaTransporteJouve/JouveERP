import { z } from "zod";

import { isCheckAccount, type Account } from "@/features/accounts/schema";
import { isoDate } from "@/features/exchange-rates/schema";
import {
  getLoanAction,
  listLoansAction,
} from "@/features/loans/actions/loans-actions";
import { LOAN_CASH_PERMISSIONS } from "@/features/loans/lib/loan-cash";
import { LOAN_KIND_LABEL, type LoanListItem } from "@/features/loans/schema";
import { TREASURY_PERMISSIONS } from "@/lib/auth/permissions";
import { payLoanInstallment } from "@/lib/commands/pay-loan-installment";
import { formatArgentineDate, formatMoney, todayInAR } from "@/lib/format";

import {
  LOAN_INSTALLMENT_LABELS,
  loanInstallmentPaymentProposalSpec,
} from "../../lib/proposal-specs";
import { defineAiProposal, type AiPrepareResult } from "../propose";

import { resolveTreasuryAccount } from "./hr-refs";
import { MAX_CANDIDATES, norm } from "./resolve-client";

// "Pagar cuota" of a loan (Préstamos → detalle). The cuota and its amount
// come from the loan's schedule; the RPC claims the pending cuota, so one
// already paid is refused when the user accepts.

function loanLabel(l: LoanListItem): string {
  return `${LOAN_KIND_LABEL[l.kind]} ${l.description}${l.lender ? ` (${l.lender})` : ""}`;
}

/** An active loan by its description or lender: the exact one, else the
 *  only one that contains what the user said. */
async function resolveLoan(
  said: string,
): Promise<
  { ok: true; loan: LoanListItem } | { ok: false; result: AiPrepareResult }
> {
  const res = await listLoansAction();
  if (!res.ok)
    return { ok: false, result: { kind: "error", error: res.error } };
  const active = res.data.filter((l) => l.status === "active");
  const q = norm(said);
  const names = (l: LoanListItem) => [l.description, l.lender ?? ""].map(norm);
  const exact = active.filter((l) => names(l).includes(q));
  const close = active.filter((l) => names(l).some((n) => n.includes(q)));
  const pick =
    exact.length === 1 ? exact[0] : close.length === 1 ? close[0] : undefined;
  if (pick) return { ok: true, loan: pick };
  return {
    ok: false,
    result: {
      kind: "issues",
      issues: [
        {
          field: "loan",
          message:
            close.length === 0
              ? `No hay un préstamo activo que coincida con "${said}".`
              : `"${said}" coincide con varios préstamos.`,
        },
      ],
      candidates: close.length
        ? [
            {
              field: "loan",
              options: close.slice(0, MAX_CANDIDATES).map((l) => ({
                value: l.description,
                label: loanLabel(l),
              })),
            },
          ]
        : undefined,
    },
  };
}

export const proposeLoanInstallmentPayment = defineAiProposal({
  name: "proposeLoanInstallmentPayment",
  domain: "contabilidad",
  // The loan page's gate (LOAN_CASH_PERMISSIONS: it moves Caja) plus the
  // reads of prepare: the loans (TREASURY_PERMISSIONS, which includes the
  // accounts:read of the account picker).
  permission: [...LOAN_CASH_PERMISSIONS, ...TREASURY_PERMISSIONS],
  sources: ["loans", "loan_installments", "transactions", "accounts"],
  description:
    "Propose paying an installment (cuota) of a loan or leasing for the user " +
    "to accept on a card: the next pending cuota unless the user names its " +
    "number, for its scheduled amount unless the user says another one (not " +
    "for a cuota with a desglose, paid for its amount), from an account in " +
    "the loan's currency. Writes nothing by itself.",
  input: z.object({
    loan: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .describe("Loan description or lender, as the user said it."),
    installment_number: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cuota number; default the next pending one."),
    account: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Cash or bank account to pay from, as the user said it."),
    paid_date: isoDate.optional().describe("Default today."),
    amount: z
      .number()
      .finite()
      .positive()
      .max(1_000_000_000_000)
      .optional()
      .describe("What was actually paid, when it differs from the cuota."),
  }),
  spec: loanInstallmentPaymentProposalSpec,
  prepare: async (_ctx, input) => {
    const found = await resolveLoan(input.loan);
    if (!found.ok) return found.result;
    const detail = await getLoanAction(found.loan.id);
    if (!detail.ok) return { kind: "error", error: detail.error };
    const loan = detail.data;
    const pending = loan.installments
      .filter((i) => i.status === "pendiente")
      .sort((a, b) => a.number - b.number);
    const cuota =
      input.installment_number === undefined
        ? pending[0]
        : loan.installments.find((i) => i.number === input.installment_number);
    if (!cuota || cuota.status !== "pendiente") {
      return {
        kind: "issues",
        issues: [
          {
            field: "installment_number",
            message: !cuota
              ? input.installment_number === undefined
                ? `${loanLabel(loan)} no tiene cuotas pendientes.`
                : `${loanLabel(loan)} no tiene la cuota ${input.installment_number}.`
              : `La cuota ${cuota.number} ya está pagada.`,
          },
        ],
      };
    }
    // As the loan page: a cuota with a desglose is paid for its amount.
    if (
      input.amount !== undefined &&
      cuota.split !== null &&
      input.amount !== cuota.amount
    ) {
      return {
        kind: "issues",
        issues: [
          {
            field: "amount",
            message: `La cuota ${cuota.number} tiene desglose: se paga por su monto (${formatMoney(cuota.amount, loan.currency)}). Para cambiarlo, editá la cuota.`,
          },
        ],
      };
    }
    // As the loan page: an active account in the loan's currency that moves
    // money (not a check cartera).
    const account = await resolveTreasuryAccount(
      input.account,
      (accounts: Account[]) =>
        accounts.filter(
          (a) =>
            a.is_active &&
            !isCheckAccount(a.type) &&
            a.currency === loan.currency,
        ),
      `una cuenta activa en ${loan.currency}`,
    );
    if (!account.ok) return account.result;
    return {
      kind: "draft",
      draft: {
        id: cuota.id,
        paid_date: input.paid_date ?? todayInAR(),
        account_id: account.value.id,
        amount: input.amount ?? cuota.amount,
      },
      labels: {
        [LOAN_INSTALLMENT_LABELS.loan]: loanLabel(loan),
        [LOAN_INSTALLMENT_LABELS.currency]: loan.currency,
        [cuota.id]: `${cuota.number} de ${loan.installments.length} · vence el ${formatArgentineDate(cuota.due_date)} · ${formatMoney(cuota.amount, loan.currency)}`,
        [account.value.id]: account.value.name,
      },
    };
  },
  execute: async (ctx, draft) => {
    const res = await payLoanInstallment(ctx.userId, draft);
    return res.ok ? { ok: true, data: { id: res.data.transactionId } } : res;
  },
});
