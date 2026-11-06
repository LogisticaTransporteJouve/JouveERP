import { z } from "zod";

import { isoDate } from "@/features/exchange-rates/schema";
import { getPayrollPeriodAction } from "@/features/hr/actions/payroll-actions";
import { HR_CASH_PERMISSIONS } from "@/features/hr/lib/hr-cash";
import { payrollPayableAccounts } from "@/features/hr/lib/payroll-payments";
import { suggestedPayment } from "@/features/hr/lib/payroll-split";
import {
  formatPayrollPeriod,
  PAYROLL_PAYMENT_METHOD_LABEL,
  PAYROLL_PAYMENT_METHODS,
  type PayrollEntryResolved,
} from "@/features/hr/payroll-schema";
import {
  bulkCreatePayrollPayments,
  createPayrollPayment,
} from "@/lib/commands/pay-payroll";
import { formatMoney, todayInAR } from "@/lib/format";

import {
  PAYROLL_PAYMENT_LABELS,
  payrollPaymentProposalSpec,
  type ProposalIssue,
  type ProposalLabels,
} from "../../lib/proposal-specs";
import { defineAiProposal, type ProposalCandidate } from "../propose";

import {
  HrChannelInput,
  resolveChannel,
  resolveTreasuryAccount,
} from "./hr-refs";
import { MAX_CANDIDATES, norm } from "./resolve-client";

// "Pagar" / "Pago masivo" of a payroll month. The amounts are the planilla's
// own suggestion for the method (what is left of that share, never above the
// balance), unless the user said one for a single employee; the command
// re-checks every amount against the balance when the user accepts.

/** BulkCreatePayrollPaymentsSchema's cap. */
const MAX_ITEMS = 100;

type Picked = { entry: PayrollEntryResolved; amount: number };

/** The period's entries the user named, by name (exact, else the one that
 *  contains it), or the questions to ask. */
function pickEntries(
  entries: readonly PayrollEntryResolved[],
  names: readonly string[],
):
  | { ok: true; entries: PayrollEntryResolved[] }
  | {
      ok: false;
      issues: ProposalIssue[];
      candidates: ProposalCandidate[];
    } {
  const picked: PayrollEntryResolved[] = [];
  const issues: ProposalIssue[] = [];
  const candidates: ProposalCandidate[] = [];
  names.forEach((name, i) => {
    const q = norm(name);
    const exact = entries.filter((e) => norm(e.employee_legal_name) === q);
    const close = entries.filter((e) =>
      norm(e.employee_legal_name).includes(q),
    );
    const one =
      exact.length === 1 ? exact[0] : close.length === 1 ? close[0] : undefined;
    if (one) {
      if (!picked.includes(one)) picked.push(one);
      return;
    }
    const field = `employees.${i}`;
    issues.push({
      field,
      message:
        close.length === 0
          ? `"${name}" no está en la planilla de ese período.`
          : `"${name}" coincide con varios empleados de la planilla.`,
    });
    if (close.length) {
      candidates.push({
        field,
        options: close.slice(0, MAX_CANDIDATES).map((e) => ({
          value: e.employee_legal_name,
          label: e.employee_legal_name,
        })),
      });
    }
  });
  return issues.length
    ? { ok: false, issues, candidates }
    : { ok: true, entries: picked };
}

export const proposePayrollPayment = defineAiProposal({
  name: "proposePayrollPayment",
  domain: "rrhh",
  // The payroll dialogs' gate (HR_CASH_PERMISSIONS: hr:write +
  // transactions:write) plus the reads of prepare: the planilla (hr:read)
  // and the accounts to pay from (accounts:read).
  permission: [...HR_CASH_PERMISSIONS, "hr:read", "accounts:read"],
  sources: [
    "payroll_periods",
    "v_payroll_entries_with_payments",
    "payroll_payments",
    "accounts",
  ],
  description:
    "Propose paying salaries of a payroll month (Pagar / Pago masivo de la " +
    "planilla) for the user to accept on a card: one employee or several, by " +
    "transfer or cash, from an ARS cash/bank account, on a channel. Without " +
    "employees it pays everyone with a pending balance for that method. The " +
    "amounts are the planilla's suggestion for the method; pass amount only " +
    "when the user said one, for one employee. Writes nothing by itself.",
  input: z.object({
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .describe("Payroll month, YYYY-MM."),
    sac: z
      .boolean()
      .optional()
      .describe("True for the SAC (aguinaldo): period 06 or 12."),
    employees: z
      .array(z.string().trim().min(1).max(120))
      .max(MAX_ITEMS)
      .optional()
      .describe("Employee names as the user said them; omit for everyone."),
    amount: z
      .number()
      .positive()
      .max(999_999_999.99)
      .optional()
      .describe("Only for one employee, when the user said the amount."),
    method: z.enum(PAYROLL_PAYMENT_METHODS),
    account: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Cash or bank account to pay from, as the user said it."),
    channel: HrChannelInput,
    paid_at: isoDate.optional().describe("Payment date; default today."),
    notes: z.string().trim().max(500).optional(),
  }),
  spec: payrollPaymentProposalSpec,
  prepare: async (_ctx, input) => {
    const year = Number(input.period.slice(0, 4));
    const month = Number(input.period.slice(5, 7));
    const kind = input.sac ? "sac" : "monthly";
    if (kind === "sac" && month !== 6 && month !== 12) {
      return {
        kind: "issues",
        issues: [
          {
            field: "period",
            message: "El SAC se paga en junio (06) o en diciembre (12).",
          },
        ],
      };
    }
    const periodLabel = formatPayrollPeriod(year, month, kind);
    const res = await getPayrollPeriodAction(year, month, kind);
    if (!res.ok) return { kind: "error", error: res.error };
    if (!res.data.period) {
      return {
        kind: "issues",
        issues: [
          {
            field: "period",
            message: `No hay planilla de ${periodLabel}: hay que crearla primero en Sueldos.`,
          },
        ],
      };
    }

    const named = input.employees?.length ? input.employees : null;
    if (input.amount !== undefined && named?.length !== 1) {
      return {
        kind: "issues",
        issues: [
          {
            field: "amount",
            message:
              "Un monto solo se indica para un empleado; para varios se usa lo que sugiere la planilla.",
          },
        ],
      };
    }
    let selected: PayrollEntryResolved[];
    if (named) {
      const picked = pickEntries(res.data.entries, named);
      if (!picked.ok) {
        return {
          kind: "issues",
          issues: picked.issues,
          candidates: picked.candidates,
        };
      }
      selected = picked.entries;
    } else {
      selected = res.data.entries;
    }

    const method = PAYROLL_PAYMENT_METHOD_LABEL[input.method].toLowerCase();
    const items: Picked[] = [];
    const nothingDue: string[] = [];
    for (const entry of selected) {
      const amount = input.amount ?? suggestedPayment(entry, input.method);
      if (amount > 0) items.push({ entry, amount });
      else nothingDue.push(entry.employee_legal_name);
    }
    if (items.length === 0 || (named && nothingDue.length > 0)) {
      return {
        kind: "issues",
        issues: [
          {
            field: named ? "employees" : "period",
            message: named
              ? `${nothingDue.join(", ")} no tiene saldo pendiente por ${method} en ${periodLabel}.`
              : `Nadie tiene saldo pendiente por ${method} en ${periodLabel}.`,
          },
        ],
      };
    }
    if (items.length > MAX_ITEMS) {
      return {
        kind: "issues",
        issues: [
          {
            field: "employees",
            message: `Son ${items.length} pagos: el máximo por vez es ${MAX_ITEMS}. Indicá a quiénes.`,
          },
        ],
      };
    }

    const account = await resolveTreasuryAccount(
      input.account,
      payrollPayableAccounts,
      "una cuenta activa en pesos (caja o banco)",
    );
    if (!account.ok) return account.result;
    const channel = await resolveChannel(input.channel);
    if (!channel.ok) return channel.result;

    const labels: ProposalLabels = {
      [PAYROLL_PAYMENT_LABELS.period]: periodLabel,
      [account.value.id]: account.value.name,
      [channel.value.id]: channel.value.name,
    };
    for (const { entry } of items) {
      labels[entry.id] =
        `${entry.employee_legal_name} (saldo ${formatMoney(Math.max(entry.saldo, 0))})`;
    }
    return {
      kind: "draft",
      draft: {
        items: items.map(({ entry, amount }) => ({
          entry_id: entry.id,
          amount,
        })),
        account_id: account.value.id,
        channel_id: channel.value.id,
        method: input.method,
        paid_at: input.paid_at ?? todayInAR(),
        notes: input.notes ?? null,
      },
      labels,
    };
  },
  // One employee goes through "Pagar" (its own audit event), several
  // through "Pago masivo": the same writes as the planilla's two dialogs.
  execute: async (ctx, draft) => {
    const { items, ...rest } = draft;
    const [only] = items;
    if (items.length === 1 && only) {
      return createPayrollPayment(ctx.userId, { ...rest, ...only });
    }
    const res = await bulkCreatePayrollPayments(ctx.userId, draft);
    if (!res.ok) return res;
    return {
      ok: true,
      data: {
        id: draft.account_id,
        note: `${res.data.inserted} pagos registrados.`,
      },
    };
  },
});
