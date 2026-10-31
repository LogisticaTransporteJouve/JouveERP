import "server-only";

import type { ManualJournalEntryCreateInput } from "@/features/journal-entries/schema";
import { logAudit } from "@/lib/actions/audit";
import type { Json } from "@/lib/db/database.types";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/**
 * Creates a manual journal entry through create_manual_journal_entry, with the
 * caller's session, and audits it. The RPC takes no source and only a NULL or
 * active fiscal channel, and derives the accrual period from the date. The
 * caller has already checked `accounting:write` and parsed the input with
 * `ManualJournalEntryCreateSchema`; the DB re-validates Σdebe = Σhaber.
 */
export async function createManualJournalEntry(
  actorId: string,
  data: ManualJournalEntryCreateInput,
): Promise<ActionResult<{ id: string }>> {
  const lines: Json = data.lines.map((l) => ({
    account_id: l.account_id,
    debit: l.debit,
    credit: l.credit,
    description: l.description ?? null,
  }));

  const supabase = await createClient();
  const { data: entryId, error } = await supabase.rpc(
    "create_manual_journal_entry",
    {
      p_entry_date: data.entry_date,
      p_description: data.description,
      p_lines: lines,
      ...(data.channel_id ? { p_channel_id: data.channel_id } : {}),
    },
  );
  const guardError = mapDbGuardError(error, {
    slug: "journal_entries.manual_create.rejected",
    userId: actorId,
  });
  if (guardError) return { ok: false, error: guardError };
  if (error || !entryId) {
    logger.error("journal_entries.manual_create.failed", {
      userId: actorId,
      entry_date: data.entry_date,
      error,
    });
    return {
      ok: false,
      error: error?.message ?? "No se pudo crear el asiento.",
    };
  }

  await logAudit(
    "journal_entry.manual_created",
    actorId,
    {
      entry_date: data.entry_date,
      description: data.description,
      lines: data.lines.length,
      total_debit: data.lines.reduce((a, l) => a + l.debit, 0),
    },
    entryId,
  );
  return { ok: true, data: { id: entryId } };
}
