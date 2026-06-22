"use server";

import type { ActionResult } from "@/lib/query/run-action";

import { requireUserContext } from "@/lib/auth/context";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import { SearchGlobalInputSchema, type SearchResult } from "../schema";

export async function searchGlobalAction(input: {
  query: string;
  limit?: number;
}): Promise<ActionResult<SearchResult[]>> {
  const ctx = await requireUserContext();
  const parsed = SearchGlobalInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Input inválido.",
    };
  }
  input = parsed.data;
  const q = input.query.trim();
  if (q.length < 2) {
    return { ok: true, data: [] };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_global", {
    p_query: q,
    p_limit: Math.min(input.limit ?? 20, 50),
  });
  if (error) {
    logger.error("search_global.failed", {
      userId: ctx.userId,
      query: q,
      error,
    });
    return { ok: false, error: "Búsqueda falló." };
  }
  return { ok: true, data: (data ?? []) as SearchResult[] };
}
