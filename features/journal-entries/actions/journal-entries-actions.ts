"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Json } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { PeriodSchema } from "@/lib/validation/common";

import {
  accrualPeriodFromDate,
  ManualJournalEntryCreateSchema,
  type JournalEntryWithLines,
  type JournalFilters,
} from "../schema";

import { JOURNAL_PAGE_SIZE } from "../lib/journal-pagination";
import type { JournalPage } from "../lib/journal-pagination";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const JournalFiltersInput = z.object({
  period: PeriodSchema.nullable().optional(),
  sourceTable: z
    .enum(["transactions", "invoices", "receipts", "payment_orders", "all"])
    .nullable()
    .optional(),
  channelId: z.string().nullable().optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export async function listJournalEntriesAction(
  filters: JournalFilters & { offset?: number; limit?: number },
): Promise<ActionResult<JournalPage>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    return { ok: false, error: "No tenés permiso para ver el libro diario." };
  }

  const parsed = JournalFiltersInput.safeParse(filters);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input inválido." };
  }
  filters = parsed.data;

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
    // Tie-breaker: two entries created in the same tx (e.g. emit_journal_*
    // triggered by a multi-row insert) share the same created_at.
    .order("id", { ascending: false })
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
    logger.error("journal_entries.list.failed", { userId: ctx.userId, error });
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

/**
 * Creates a manual journal entry (source_table null) via the same
 * create_journal_entry RPC the auto-posting triggers use. The schema validates
 * balance client-side; the DB DEFERRABLE trigger re-validates Σdebe = Σhaber.
 */
export async function createManualJournalEntryAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:write")) {
    return { ok: false, error: "No tenés permiso para cargar asientos." };
  }

  const parsed = ManualJournalEntryCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const lines: Json = data.lines.map((l) => ({
    account_id: l.account_id,
    debit: l.debit,
    credit: l.credit,
    description: l.description ?? null,
  }));

  const supabase = await createClient();
  const { data: entryId, error } = await supabase.rpc("create_journal_entry", {
    p_entry_date: data.entry_date,
    p_accrual_period: accrualPeriodFromDate(data.entry_date),
    p_description: data.description,
    p_lines: lines,
    ...(data.channel_id ? { p_channel_id: data.channel_id } : {}),
  });
  if (error || !entryId) {
    logger.error("journal_entries.manual_create.failed", {
      userId: ctx.userId,
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
    ctx.userId,
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
