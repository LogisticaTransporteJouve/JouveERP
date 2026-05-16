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

import { JOURNAL_PAGE_SIZE } from "../lib/journal-pagination";
import type { JournalPage } from "../lib/journal-pagination";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function listJournalEntriesAction(
  filters: JournalFilters & { offset?: number; limit?: number },
): Promise<ActionResult<JournalPage>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    return { ok: false, error: "No tenés permiso para ver el libro diario." };
  }

  if (filters.period && !isPeriodFormat(filters.period)) {
    return { ok: false, error: "Período inválido, formato esperado YYYY-MM." };
  }

  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? JOURNAL_PAGE_SIZE;

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
    .range(offset, offset + limit - 1);

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

  const items = (data ?? []) as JournalEntryWithLines[];
  return {
    ok: true,
    data: {
      items,
      nextOffset: items.length === limit ? offset + limit : null,
    },
  };
}
