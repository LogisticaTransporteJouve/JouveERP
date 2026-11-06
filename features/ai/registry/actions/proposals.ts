import { z } from "zod";

import { listChartOfAccountsAction } from "@/features/chart-of-accounts/actions/chart-of-accounts-actions";
import type { ChartAccount } from "@/features/chart-of-accounts/schema";
import { getUsdReferenceRateAction } from "@/features/exchange-rates/actions/exchange-rates-actions";
import { isoDate } from "@/features/exchange-rates/schema";
import { LEAVE_KINDS } from "@/features/hr/vacation-schema";
import { createLeave } from "@/lib/commands/create-leave";
import { createManualJournalEntry } from "@/lib/commands/create-manual-journal-entry";
import { upsertManualExchangeRate } from "@/lib/commands/upsert-exchange-rate";

import {
  exchangeRateProposalSpec,
  journalEntryProposalSpec,
  leaveProposalSpec,
  rateReferenceLabels,
  type ProposalIssue,
} from "../../lib/proposal-specs";
import { defineAiProposal, type ProposalCandidate } from "../propose";

import { resolveEmployee } from "./hr-refs";
import { MAX_CANDIDATES, norm } from "./resolve-client";

// Lookups go through the read actions (their own gate + RLS); the writes run
// only after the user confirms, through the same lib/commands function the
// manual form's server action calls.

export const proposeLeave = defineAiProposal({
  name: "proposeLeave",
  domain: "rrhh",
  permission: ["hr:write", "hr:read"],
  sources: ["employees", "employee_leaves"],
  description:
    "Propose registering an employee leave (vacaciones, enfermedad, franco, " +
    "maternidad, paternidad, otro) for the user to confirm on a card. Writes " +
    "nothing by itself. Dates are YYYY-MM-DD, both inclusive.",
  input: z.object({
    employee: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Employee name or CUIL, as the user said it."),
    start_date: isoDate,
    end_date: isoDate,
    kind: z.enum(LEAVE_KINDS),
    notes: z.string().trim().max(500).optional(),
  }),
  spec: leaveProposalSpec,
  prepare: async (_ctx, input) => {
    const found = await resolveEmployee(input.employee);
    if (!found.ok) return found.result;
    const pick = found.value;
    return {
      kind: "draft",
      draft: {
        employee_id: pick.id,
        start_date: input.start_date,
        end_date: input.end_date,
        kind: input.kind,
        notes: input.notes ?? null,
      },
      labels: { [pick.id]: pick.legal_name },
    };
  },
  execute: (ctx, draft) => createLeave(ctx.userId, draft),
});

function accountLabel(a: ChartAccount): string {
  return `${a.code} ${a.name}`;
}

/** The one active account a reference names: its exact code, or its exact
 *  name; otherwise the closest few as candidates. */
function resolveAccount(
  accounts: readonly ChartAccount[],
  ref: string,
): { account: ChartAccount } | { candidates: ChartAccount[] } {
  const q = norm(ref);
  const byCode = accounts.find((a) => a.code === ref.trim());
  if (byCode) return { account: byCode };
  const byName = accounts.filter((a) => norm(a.name) === q);
  if (byName.length === 1 && byName[0]) return { account: byName[0] };
  const close = accounts.filter(
    (a) => norm(a.name).includes(q) || a.code.startsWith(ref.trim()),
  );
  if (close.length === 1 && close[0]) return { account: close[0] };
  return { candidates: close.slice(0, MAX_CANDIDATES) };
}

const amount = z.number().finite().min(0).max(1_000_000_000_000);

export const proposeJournalEntry = defineAiProposal({
  name: "proposeJournalEntry",
  domain: "contabilidad",
  permission: ["accounting:write", "accounting:read"],
  sources: ["chart_of_accounts", "journal_entries"],
  description:
    "Propose a manual journal entry (asiento manual) for the user to confirm " +
    "on a card. Writes nothing by itself. Each line names an account by code " +
    "or exact name and carries either debit or credit; the entry must balance.",
  input: z.object({
    entry_date: isoDate,
    description: z.string().trim().min(1).max(500),
    lines: z
      .array(
        z.object({
          account: z
            .string()
            .trim()
            .min(1)
            .max(120)
            .describe("Account code (e.g. 1.1.01.001) or exact name."),
          debit: amount.optional(),
          credit: amount.optional(),
          description: z.string().trim().max(300).optional(),
        }),
      )
      .min(2)
      .max(30),
  }),
  spec: journalEntryProposalSpec,
  prepare: async (_ctx, input) => {
    const res = await listChartOfAccountsAction({ onlyActive: true });
    if (!res.ok) return { kind: "error", error: res.error };
    const issues: ProposalIssue[] = [];
    const candidates: ProposalCandidate[] = [];
    const labels: Record<string, string> = {};
    const lines = input.lines.map((line, i) => {
      const found = resolveAccount(res.data, line.account);
      if ("candidates" in found) {
        const field = `lines.${i}.account`;
        issues.push({
          field,
          message:
            found.candidates.length === 0
              ? `No hay una cuenta activa "${line.account}".`
              : `"${line.account}" coincide con varias cuentas.`,
        });
        if (found.candidates.length) {
          candidates.push({
            field,
            options: found.candidates.map((a) => ({
              value: a.code,
              label: accountLabel(a),
            })),
          });
        }
        return null;
      }
      labels[found.account.id] = accountLabel(found.account);
      return {
        account_id: found.account.id,
        debit: line.debit ?? 0,
        credit: line.credit ?? 0,
        description: line.description ?? null,
      };
    });
    if (issues.length) return { kind: "issues", issues, candidates };
    return {
      kind: "draft",
      draft: {
        entry_date: input.entry_date,
        description: input.description,
        lines,
      },
      labels,
    };
  },
  execute: (ctx, draft) => createManualJournalEntry(ctx.userId, draft),
});

export const proposeExchangeRate = defineAiProposal({
  name: "proposeExchangeRate",
  domain: "contabilidad",
  permission: "accounting:write",
  sources: ["exchange_rates"],
  description:
    "Propose loading a manual USD exchange rate (ARS per USD) for a date, for " +
    "the user to confirm on a card. It replaces the BCRA rate of that day. " +
    "Writes nothing by itself.",
  input: z.object({
    rate_date: isoDate,
    rate: z.number().positive().max(9_999_999.999999),
    notes: z.string().trim().max(500).optional(),
  }),
  spec: exchangeRateProposalSpec,
  // The card warns on a >30% jump from the nearest stored rate, as the
  // Cotizaciones page asks before saving.
  prepare: async (_ctx, input) => {
    const ref = await getUsdReferenceRateAction(input.rate_date);
    return {
      kind: "draft",
      draft: {
        rate_date: input.rate_date,
        rate: input.rate,
        notes: input.notes ?? null,
      },
      labels: rateReferenceLabels(ref.ok ? ref.data : "unread"),
    };
  },
  execute: (ctx, draft) => upsertManualExchangeRate(ctx.userId, draft),
});
