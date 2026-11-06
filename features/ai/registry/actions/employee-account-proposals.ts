import { z } from "zod";

import { isCheckAccount, type Account } from "@/features/accounts/schema";
import { isoDate } from "@/features/exchange-rates/schema";
import { ACCOUNT_CURRENCIES, CREDITORS } from "@/features/hr/account-schema";
import { HR_CASH_PERMISSIONS } from "@/features/hr/lib/hr-cash";
import {
  createEmployeeAccountMovement,
  recordEmployeeAccountCash,
} from "@/lib/commands/record-employee-account";
import { todayInAR } from "@/lib/format";

import {
  EMPLOYEE_ACCOUNT_LABELS,
  employeeAccountCashProposalSpec,
  employeeAccountMovementProposalSpec,
} from "../../lib/proposal-specs";
import { defineAiProposal } from "../propose";

import {
  HrChannelInput,
  resolveChannel,
  resolveEmployee,
  resolveTreasuryAccount,
} from "./hr-refs";

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
    "discount_in_payroll is false. Writes nothing by itself.",
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
  }),
  spec: employeeAccountCashProposalSpec,
  prepare: async (_ctx, input) => {
    const employee = await resolveEmployee(input.employee);
    if (!employee.ok) return employee.result;
    const account = await resolveTreasuryAccount(
      input.account,
      cashAccounts,
      "una cuenta activa de caja o banco",
    );
    if (!account.ok) return account.result;
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
        plan_id: null,
        installment_amount: installment,
      },
      labels: {
        [employee.value.id]: employee.value.legal_name,
        [account.value.id]: `${account.value.name} (${account.value.currency})`,
        [channel.value.id]: channel.value.name,
        [EMPLOYEE_ACCOUNT_LABELS.currency]: account.value.currency,
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
  }),
  spec: employeeAccountMovementProposalSpec,
  prepare: async (_ctx, input) => {
    const employee = await resolveEmployee(input.employee);
    if (!employee.ok) return employee.result;
    return {
      kind: "draft",
      draft: {
        employee_id: employee.value.id,
        kind: input.kind,
        currency: input.currency ?? "ARS",
        amount: input.amount,
        movement_date: input.movement_date ?? todayInAR(),
        description: input.description,
        creditor: input.creditor ?? "empresa",
        plan_id: null,
      },
      labels: { [employee.value.id]: employee.value.legal_name },
    };
  },
  execute: (ctx, draft) => createEmployeeAccountMovement(ctx.userId, draft),
});
