"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import {
  isPeriodFormat,
  type JournalEntryWithLines,
  type JournalFilters,
} from "../schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function listJournalEntriesAction(
  filters: JournalFilters,
): Promise<ActionResult<JournalEntryWithLines[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    return { ok: false, error: "No tenés permiso para ver el libro diario." };
  }

  if (filters.period && !isPeriodFormat(filters.period)) {
    return { ok: false, error: "Período inválido, formato esperado YYYY-MM." };
  }

  const supabase = await createClient();
  const query = supabase
    .from("journal_entries")
    .select(
      `
      *,
      lines:journal_entry_lines(
        *,
        account:chart_of_accounts(id, code, name)
      ),
      channel:invoicing_channels(id, name)
      `,
    )
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.period) {
    query.eq("accrual_period", filters.period);
  }
  if (filters.sourceTable && filters.sourceTable !== "all") {
    query.eq("source_table", filters.sourceTable);
  }
  if (filters.channelId) {
    query.eq("channel_id", filters.channelId);
  }

  const { data, error } = await query;
  if (error) {
    logger.error("journal_entries.list.failed", { error });
    return { ok: false, error: "No se pudo leer el libro diario." };
  }

  return {
    ok: true,
    data: (data ?? []) as unknown as JournalEntryWithLines[],
  };
}
