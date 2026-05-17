"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

import type { SearchResult } from "../schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const SearchGlobalInput = z.object({
  query: z.string().trim().max(200, "Búsqueda demasiado larga."),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function searchGlobalAction(input: {
  query: string;
  limit?: number;
}): Promise<ActionResult<SearchResult[]>> {
  await requireUserContext();
  const parsed = SearchGlobalInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Input inválido." };
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
    logger.error("search_global.failed", { error });
    return { ok: false, error: "Búsqueda falló." };
  }
  return { ok: true, data: (data ?? []) as SearchResult[] };
}
