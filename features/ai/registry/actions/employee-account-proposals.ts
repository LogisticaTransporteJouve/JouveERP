import { z } from "zod";

import { isCheckAccount, type Account } from "@/features/accounts/schema";
import { isoDate } from "@/features/exchange-rates/schema";
import { getEmployeeAccountAction } from "@/features/hr/actions/employee-account-actions";
import {
  ACCOUNT_CURRENCIES,
  CREDITORS,
  type DebtPlan,
} from "@/features/hr/account-schema";
import { HR_CASH_PERMISSIONS } from "@/features/hr/lib/hr-cash";
import {
  createEmployeeAccountMovement,
  recordEmployeeAccountCash,
} from "@/lib/commands/record-employee-account";
import { formatMoney, todayInAR } from "@/lib/format";

import {
  EMPLOYEE_ACCOUNT_LABELS,
  employeeAccountCashProposalSpec,
  employeeAccountMovementProposalSpec,
} from "../../lib/proposal-specs";
import { defineAiProposal, type AiPrepareResult } from "../propose";

import {
  HrChannelInput,
  resolveChannel,
  resolveEmployee,
  resolveTreasuryAccount,
} from "./hr-refs";
import { MAX_CANDIDATES, norm } from "./resolve-client";
import { CHANNEL_SIDES, type Resolved } from "./treasury-refs";

// The employee's cuenta corriente (ficha del empleado): an advance or the
// employee's payment through a cash/bank account, or a charge or payment
// typed by hand. The same writes as the account card's dialogs.

const money = z.number().positive().max(999_999_999.99);

const employeeRef = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe("Employee name or CUIL, as the user said it.");

const planRef = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .describe(
    "The employee's debt plan (by its description) this is applied to; " +
      "omit unless the user named one.",
  );

/** The employee's plan the user named, among those the dialog offers
 *  (`offered`): the exact description, else the only one that contains it;
 *  otherwise a question offering them. */
async function resolvePlan(
  employeeId: string,
  said: string,
  offered: (p: DebtPlan) => boolean,
): Promise<Resolved<DebtPlan>> {
  const res = await getEmployeeAccountAction(employeeId);
  if (!res.ok)
    return { ok: false, result: { kind: "error", error: res.error } };
  const plans = res.data.plans.filter(offered);
  const q = norm(said);
  const exact = plans.filter((p) => norm(p.description) === q);
  const close = plans.filter((p) => norm(p.description).includes(q));
  const pick =
    exact.length === 1 ? exact[0] : close.length === 1 ? close[0] : undefined;
  if (pick) return { ok: true, value: pick };
  const options = close.length > 1 ? close : plans;
  const result: AiPrepareResult = {
    kind: "issues",
    issues: [
      {
        field: "plan",
        message:
          plans.length === 0
            ? "El empleado no tiene un plan al que se pueda imputar."
            : close.length > 1
              ? `"${said}" coincide con varios planes.`
              : `No hay un plan que coincida con "${said}".`,
      },
    ],
    ...(options.length
      ? {
          candidates: [
            {
              field: "plan",
              options: options.slice(0, MAX_CANDIDATES).map((p) => ({
                value: p.description,
                label: `${p.description} · resta ${formatMoney(p.remaining, p.currency)}`,
              })),
            },
          ],
        }
      : {}),
  };
  return { ok: false, result };
}

/** The accounts the cash dialog offers: active, not a check portfolio. */
function cashAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => a.is_active && !isCheckAccount(a.type));
}

export const proposeEmployeeAccountCash = defineAiProposal({
  name: "proposeEmployeeAccountCash",
  domain: "rrhh",
  // The dialog's gate (HR_CASH_PERMISSIONS: it moves Caja) plus the reads
  // of prepare: the employee (hr:read) and the accounts (accounts:read).
  permission: [...HR_CASH_PERMISSIONS, "hr:read", "accounts:read"],
  sources: ["employee_account_movements", "transactions", "accounts"],
  description:
    "Propose an advance to an employee (adelanto, sale plata de una cuenta) " +
    "or a payment by the employee (pago del empleado, entra plata) for the " +
    "user to accept on a card: the Caja movement and the employee's account " +
    "movement together. An advance is discounted in the planilla in one " +
    "month unless installment_amount says the monthly cuota, or " +
    "discount_in_payroll is false. A payment can be applied to one of the " +
    "employee's debt plans (plan). Writes nothing by itself.",
  input: z.object({
    employee: employeeRef,
    kind: z.enum(["advance", "payment"]),
    amount: money.describe("In the account's currency."),
    account: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Cash or bank account, as the user said it."),
    channel: HrChannelInput,
    date: isoDate.optional().describe("Default today."),
    description: z.string().trim().max(200).optional(),
    installment_amount: money
      .optional()
      .describe("Advance only: monthly cuota discounted in the planilla."),
    discount_in_payroll: z
      .boolean()
      .optional()
      .describe("Advance only: false = no plan, it stays as a debt."),
    plan: planRef.describe(
      "Payment only: the debt plan (by its description) it is applied to.",
    ),
  }),
  spec: employeeAccountCashProposalSpec,
  prepare: async (_ctx, input) => {
    if (input.plan !== undefined && input.kind !== "payment") {
      return {
        kind: "issues",
        issues: [
          {
            field: "plan",
            message:
              "Un adelanto abre su propio plan; solo un pago se imputa a un plan.",
          },
        ],
      };
    }
    const employee = await resolveEmployee(input.employee);
    if (!employee.ok) return employee.result;
    const account = await resolveTreasuryAccount(
      input.account,
      cashAccounts,
      "una cuenta activa de caja o banco",
    );
    if (!account.ok) return account.result;
    // As the dialog: a plan of the account's currency with something left.
    const currency = account.value.currency;
    const plan =
      input.plan === undefined
        ? undefined
        : await resolvePlan(
            employee.value.id,
            input.plan,
            (p) => p.currency === currency && p.remaining > 0,
          );
    if (plan && !plan.ok) return plan.result;
    const channel = await resolveChannel(input.channel);
    if (!channel.ok) return channel.result;
    // As the dialog: an advance opens a plan for the whole amount unless
    // the user says the cuota or no plan.
    const installment =
      input.kind !== "advance" || input.discount_in_payroll === false
        ? null
        : (input.installment_amount ?? input.amount);
    return {
      kind: "draft",
      draft: {
        employee_id: employee.value.id,
        kind: input.kind,
        account_id: account.value.id,
        channel_id: channel.value.id,
        date: input.date ?? todayInAR(),
        amount: input.amount,
        description: input.description ?? null,
        plan_id: plan?.value.id ?? null,
        installment_amount: installment,
      },
      labels: {
        [employee.value.id]: employee.value.legal_name,
        [account.value.id]: `${account.value.name} (${account.value.currency})`,
        [channel.value.id]: channel.value.name,
        [EMPLOYEE_ACCOUNT_LABELS.currency]: account.value.currency,
        ...(plan ? { [plan.value.id]: plan.value.description } : {}),
      },
    };
  },
  execute: (ctx, draft) => recordEmployeeAccountCash(ctx.userId, draft),
});

export const proposeEmployeeAccountMovement = defineAiProposal({
  name: "proposeEmployeeAccountMovement",
  domain: "rrhh",
  permission: ["hr:write", "hr:read"],
  sources: ["employee_account_movements"],
  description:
    "Propose a manual movement in an employee's account (cuenta corriente) " +
    "with no cash: a charge (cargo: a debt with the company or a partner, an " +
    "opening balance) or a payment received outside the company, for the " +
    "user to accept on a card. For money that leaves or enters a cash/bank " +
    "account use proposeEmployeeAccountCash. Writes nothing by itself.",
  input: z.object({
    employee: employeeRef,
    kind: z.enum(["charge", "payment"]),
    amount: money,
    currency: z.enum(ACCOUNT_CURRENCIES).optional(),
    movement_date: isoDate.optional().describe("Default today."),
    description: z.string().trim().min(1).max(200),
    creditor: z
      .enum(CREDITORS)
      .optional()
      .describe("Who is owed: empresa (default) or socio."),
    plan: planRef,
  }),
  spec: employeeAccountMovementProposalSpec,
  prepare: async (_ctx, input) => {
    const employee = await resolveEmployee(input.employee);
    if (!employee.ok) return employee.result;
    // As the dialog: a plan of the movement's currency, not forgiven.
    const currency = input.currency ?? "ARS";
    const plan =
      input.plan === undefined
        ? undefined
        : await resolvePlan(
            employee.value.id,
            input.plan,
            (p) => p.currency === currency && p.status !== "condonado",
          );
    if (plan && !plan.ok) return plan.result;
    return {
      kind: "draft",
      draft: {
        employee_id: employee.value.id,
        kind: input.kind,
        currency,
        amount: input.amount,
        movement_date: input.movement_date ?? todayInAR(),
        description: input.description,
        creditor: input.creditor ?? "empresa",
        plan_id: plan?.value.id ?? null,
      },
      labels: {
        [employee.value.id]: employee.value.legal_name,
        ...(plan ? { [plan.value.id]: plan.value.description } : {}),
      },
    };
  },
  execute: (ctx, draft) => createEmployeeAccountMovement(ctx.userId, draft),
});
