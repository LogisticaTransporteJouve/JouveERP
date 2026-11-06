import { z } from "zod";

import { isCheckAccount } from "@/features/accounts/schema";
import { listEnCarteraChecksAction } from "@/features/checks/actions/checks-actions";
import { CHECK_KINDS } from "@/features/checks/schema";
import { isoDate } from "@/features/exchange-rates/schema";
import { ISSUED_CHECK_KINDS } from "@/features/issued-checks/schema";
import { createIssuedCheck } from "@/lib/commands/create-issued-check";
import { createManualCheck } from "@/lib/commands/create-manual-check";
import { depositCheck } from "@/lib/commands/deposit-check";
import { formatArgentineDate, formatMoney, todayInAR } from "@/lib/format";

import {
  DEPOSIT_CHECK_LABEL,
  checkDepositProposalSpec,
  issuedCheckProposalSpec,
  manualCheckProposalSpec,
} from "../../lib/proposal-specs";
import { defineAiProposal } from "../propose";

import {
  accountLabel,
  activeChannels,
  channelFor,
  ChannelSideInput,
  resolveAccount,
} from "./treasury-refs";
import { MAX_CANDIDATES, norm } from "./resolve-client";

// Check proposals over the writes of Cheques and Cheques propios: load a
// received check into a cartera, deposit one from the cartera, load one of
// our own. The amounts are the user's (or the check's, read from the
// cartera); accepting runs the same lib/commands write as the page.

const amount = z.number().finite().positive().max(1_000_000_000_000);

/** A check number as typed: digits only, no leading zeros. */
function numberKey(text: string): string {
  return text.replace(/\D/g, "").replace(/^0+/, "");
}

export const proposeManualCheck = defineAiProposal({
  name: "proposeManualCheck",
  domain: "tesoreria",
  permission: ["cheques:write", "transactions:write", "accounts:read"],
  sources: ["checks", "accounts"],
  description:
    "Propose loading a received third-party check (físico or e-cheq) into " +
    "a check cartera by hand, for the user to accept on a card: number, " +
    "bank, drawer (firmante), amount, due date (fecha de cobro). Not tied " +
    "to a receipt: a client's payment with a check is proposeReceipt. " +
    "Writes nothing by itself.",
  input: z.object({
    kind: z.enum(CHECK_KINDS).optional().describe("Default 'fisico'."),
    check_number: z.string().trim().min(1).max(60),
    bank: z.string().trim().min(1).max(120),
    drawer: z.string().trim().min(1).max(120),
    drawer_cuit: z.string().trim().max(20).optional(),
    amount,
    issue_date: isoDate.optional().describe("Default today."),
    due_date: isoDate,
    cartera: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe("Check cartera account name; omit when there is one."),
    channel: ChannelSideInput,
    notes: z.string().trim().max(500).optional(),
  }),
  spec: manualCheckProposalSpec,
  prepare: async (_ctx, input) => {
    const kind = input.kind ?? "fisico";
    const cartera = await resolveAccount(
      input.cartera,
      "cartera",
      (a) => a.type === (kind === "echeq" ? "echeq" : "checks"),
    );
    if (!cartera.ok) return cartera.result;
    const chans = await activeChannels();
    if (!chans.ok) return chans.result;
    const channel = channelFor(chans.value, input.channel);
    if (!channel.ok) return channel.result;
    return {
      kind: "draft",
      draft: {
        kind,
        check_number: input.check_number,
        bank_name: input.bank,
        drawer_name: input.drawer,
        drawer_cuit: input.drawer_cuit ?? null,
        issue_date: input.issue_date ?? todayInAR(),
        due_date: input.due_date,
        amount: input.amount,
        currency: cartera.value.currency,
        cartera_account_id: cartera.value.id,
        channel_id: channel.value.id,
        notes: input.notes ?? null,
      },
      labels: {
        [cartera.value.id]: accountLabel(cartera.value),
        [channel.value.id]: channel.value.name,
      },
    };
  },
  execute: (ctx, draft) => createManualCheck(ctx.userId, draft),
});

export const proposeCheckDeposit = defineAiProposal({
  name: "proposeCheckDeposit",
  domain: "tesoreria",
  permission: [
    "cheques:write",
    "transactions:write",
    "cheques:read",
    "accounts:read",
  ],
  sources: ["checks", "accounts"],
  description:
    "Propose depositing a check that is in cartera into a bank account, for " +
    "the user to accept on a card: the check by its number (and bank when " +
    "several match), the destination account, date (default today). Writes " +
    "nothing by itself.",
  input: z.object({
    check_number: z.string().trim().min(1).max(60),
    bank: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe("The check's bank, when the number alone is ambiguous."),
    account: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Bank account it is deposited into, by name."),
    event_date: isoDate.optional(),
    channel: ChannelSideInput,
    description: z.string().trim().max(500).optional(),
  }),
  spec: checkDepositProposalSpec,
  prepare: async (_ctx, input) => {
    const res = await listEnCarteraChecksAction();
    if (!res.ok) return { kind: "error", error: res.error };
    const key = numberKey(input.check_number);
    const bank = input.bank ? norm(input.bank) : "";
    const found = res.data.filter(
      (c) =>
        numberKey(c.check_number) === key &&
        (!bank || norm(c.bank_name).includes(bank)),
    );
    const check = found.length === 1 ? found[0] : undefined;
    if (!check) {
      return found.length === 0
        ? {
            kind: "error",
            error: `No hay un cheque en cartera con el número ${input.check_number}.`,
          }
        : {
            kind: "issues",
            issues: [
              {
                field: "bank",
                message: `Hay varios cheques en cartera con el número ${input.check_number}.`,
              },
            ],
            candidates: [
              {
                field: "bank",
                options: found.slice(0, MAX_CANDIDATES).map((c) => ({
                  value: c.bank_name,
                  label: `${c.bank_name} · ${c.drawer_name} · ${formatMoney(c.amount, c.currency)}`,
                })),
              },
            ],
          };
    }
    const account = await resolveAccount(
      input.account,
      "account",
      (a) => !isCheckAccount(a.type) && a.currency === check.currency,
    );
    if (!account.ok) return account.result;
    const chans = await activeChannels();
    if (!chans.ok) return chans.result;
    const own = chans.value.find((c) => c.id === check.channel_id);
    const channel =
      own && !input.channel
        ? { ok: true as const, value: own }
        : channelFor(chans.value, input.channel);
    if (!channel.ok) return channel.result;
    return {
      kind: "draft",
      draft: {
        check_id: check.id,
        account_id: account.value.id,
        channel_id: channel.value.id,
        event_date: input.event_date ?? todayInAR(),
        description: input.description ?? null,
      },
      labels: {
        [DEPOSIT_CHECK_LABEL]: `Nº ${check.check_number} · ${check.bank_name} · ${check.drawer_name} · ${formatMoney(check.amount, check.currency)} · se cobra el ${formatArgentineDate(check.due_date)}`,
        [account.value.id]: accountLabel(account.value),
        [channel.value.id]: channel.value.name,
      },
    };
  },
  execute: async (ctx, draft) => {
    const res = await depositCheck(ctx.userId, draft);
    return res.ok ? { ok: true, data: { id: draft.check_id } } : res;
  },
});

export const proposeIssuedCheck = defineAiProposal({
  name: "proposeIssuedCheck",
  domain: "tesoreria",
  permission: ["issued_checks:write", "accounts:read"],
  sources: ["issued_checks", "accounts"],
  description:
    "Propose loading a check of our own (cheque propio, físico or e-cheq) " +
    "drawn on one of our bank accounts, for the user to accept on a card: " +
    "number, account, beneficiary, amount, due date. A check that pays a " +
    "supplier's payment order is loaded from the order on the page. Writes " +
    "nothing by itself.",
  input: z.object({
    kind: z.enum(ISSUED_CHECK_KINDS).optional().describe("Default 'fisico'."),
    check_number: z.string().trim().min(1).max(60),
    account: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Our bank account the check is drawn on, by name."),
    beneficiary: z.string().trim().max(120).optional(),
    amount,
    issue_date: isoDate.optional().describe("Default today."),
    due_date: isoDate,
    channel: ChannelSideInput,
    notes: z.string().trim().max(500).optional(),
  }),
  spec: issuedCheckProposalSpec,
  prepare: async (_ctx, input) => {
    const account = await resolveAccount(
      input.account,
      "account",
      (a) => a.type === "bank",
    );
    if (!account.ok) return account.result;
    const chans = await activeChannels();
    if (!chans.ok) return chans.result;
    const channel = channelFor(chans.value, input.channel);
    if (!channel.ok) return channel.result;
    return {
      kind: "draft",
      draft: {
        kind: input.kind ?? "fisico",
        check_number: input.check_number,
        bank_name: account.value.name,
        beneficiary_name: input.beneficiary ?? null,
        issue_date: input.issue_date ?? todayInAR(),
        due_date: input.due_date,
        amount: input.amount,
        currency: account.value.currency,
        bank_account_id: account.value.id,
        channel_id: channel.value.id,
        notes: input.notes ?? null,
      },
      labels: {
        [account.value.id]: accountLabel(account.value),
        [channel.value.id]: channel.value.name,
      },
    };
  },
  execute: (ctx, draft) => createIssuedCheck(ctx.userId, draft),
});
