import { z } from "zod";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import {
  ACCOUNT_CURRENCIES,
  ACCOUNT_TYPE_LABEL,
  ACCOUNT_TYPES,
} from "@/features/accounts/schema";
import {
  createAccount,
  DUPLICATE_ACCOUNT,
  isDuplicateAccount,
} from "@/lib/commands/create-account";
import { parseArAmount } from "@/lib/format";

import { treasuryAccountProposalSpec } from "../../lib/proposal-specs";
import { defineAiProposal } from "../propose";

// Tesorería › Cuentas › «Nueva cuenta», proposed on a card and created on
// accept through lib/commands/create-account, the command the form runs.

export const proposeTreasuryAccount = defineAiProposal({
  name: "proposeTreasuryAccount",
  domain: "tesoreria",
  permission: ["accounts:write", "accounts:read"],
  sources: ["accounts"],
  description:
    "Propose creating a treasury account (Tesorería › Cuentas › «Nueva " +
    "cuenta»: a bank account, cash box, digital wallet, investment or a " +
    "check cartera) for the user to accept on a card: name, type, currency " +
    "(default ARS), saldo inicial (default 0) and notes. Not a chart-of-" +
    "accounts (plan de cuentas) account. An active account with the same " +
    "name, type and currency is refused. Writes nothing by itself.",
  input: z.object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .describe("Account name, as the user said it ('Banco Galicia')."),
    type: z
      .enum(ACCOUNT_TYPES)
      .optional()
      .describe(
        "bank = banco, cash = caja/efectivo, wallet = billetera digital " +
          "(Mercado Pago), investment = inversión, checks = cheques físicos " +
          "en cartera, echeq = e-cheq en cartera. Omit unless the user said " +
          "it; the proposal asks.",
      ),
    currency: z.enum(ACCOUNT_CURRENCIES).optional(),
    opening_balance: z
      .union([z.number().finite(), z.string().trim().max(40)])
      .optional()
      .describe(
        "Saldo inicial as the user said it ('1.500.000,50' or a number); " +
          "negative for an overdrawn account. Default 0.",
      ),
    notes: z.string().trim().max(2000).optional(),
  }),
  spec: treasuryAccountProposalSpec,
  prepare: async (_ctx, input) => {
    if (!input.type) {
      return {
        kind: "issues",
        issues: [
          {
            field: "type",
            message: "Falta el tipo de cuenta (banco, caja, billetera…).",
          },
        ],
        candidates: [
          {
            field: "type",
            options: ACCOUNT_TYPES.map((t) => ({
              value: t,
              label: ACCOUNT_TYPE_LABEL[t],
            })),
          },
        ],
      };
    }
    const balance =
      typeof input.opening_balance === "string"
        ? input.opening_balance === ""
          ? 0
          : parseArAmount(input.opening_balance)
        : (input.opening_balance ?? 0);
    if (balance === null) {
      return {
        kind: "issues",
        issues: [
          { field: "opening_balance", message: "Saldo inicial inválido." },
        ],
      };
    }
    const draft = {
      name: input.name,
      type: input.type,
      currency: input.currency ?? "ARS",
      opening_balance: balance,
      notes: input.notes ?? null,
    };

    const existing = await listAccountsAction();
    if (!existing.ok) return { kind: "error", error: existing.error };
    if (isDuplicateAccount(existing.data, draft)) {
      return { kind: "error", error: DUPLICATE_ACCOUNT };
    }
    return { kind: "draft", draft };
  },
  execute: (ctx, draft) => createAccount(ctx.userId, draft),
});
