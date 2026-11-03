import "server-only";

import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

export type BankLineMatch = { line_id: string; transaction_ids: string[] };

export type BankMatchesResult = {
  matched: number;
  /** Lines that could not be matched (changed since they were read). */
  failed: { line_id: string; error: string }[];
};

/**
 * Reconciles one statement line with movements of its account through
 * match_bank_statement_line (its guards refuse a line already decided or
 * movements that do not add up) and audits it. The caller has already
 * checked `transactions:write` and parsed the input with the
 * reconciliation schema. `suggested` marks a match the user accepted from a
 * suggestion (the page's or the assistant's).
 */
export async function matchBankLine(
  actorId: string,
  match: BankLineMatch,
  suggested = false,
): Promise<ActionResult<{ line_id: string }>> {
  const { error } = await getServiceClient().rpc("match_bank_statement_line", {
    p_line_id: match.line_id,
    p_transaction_ids: match.transaction_ids,
    p_user_id: actorId,
  });
  if (error) {
    const slug = suggested ? "reconciliation.accept" : "reconciliation.match";
    const guard = mapDbGuardError(error, {
      slug: `${slug}.rejected`,
      userId: actorId,
      id: match.line_id,
    });
    if (!guard) {
      logger.error(`${slug}.failed`, {
        userId: actorId,
        id: match.line_id,
        error,
      });
    }
    return { ok: false, error: guard ?? "No se pudo conciliar la línea." };
  }
  await logAudit(
    "bank_statement_line.matched",
    actorId,
    {
      transaction_ids: match.transaction_ids,
      ...(suggested ? { suggested: true } : {}),
    },
    match.line_id,
  );
  return { ok: true, data: { line_id: match.line_id } };
}

/** Several suggested matches, each line on its own: one that went stale does
 *  not undo the others. */
export async function matchBankLines(
  actorId: string,
  matches: readonly BankLineMatch[],
): Promise<BankMatchesResult> {
  const result: BankMatchesResult = { matched: 0, failed: [] };
  for (const m of matches) {
    const res = await matchBankLine(actorId, m, true);
    if (res.ok) result.matched += 1;
    else result.failed.push({ line_id: m.line_id, error: res.error });
  }
  return result;
}
