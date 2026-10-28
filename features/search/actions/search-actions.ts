"use server";

import type { ActionResult } from "@/lib/query/run-action";

import { requireUserContext } from "@/lib/auth/context";
import { ENTITY_READ_PERMISSION } from "@/lib/auth/entity-permissions";
import { userCan } from "@/lib/auth/permissions";
import { POSTGREST_FUNCTION_NOT_FOUND } from "@/lib/db/pg-error-codes";
import { captureException, captureMessageOnce } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

import {
  SEARCH_ENTITY_TYPES,
  SearchGlobalInputSchema,
  type SearchResult,
} from "../schema";

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
  const q = parsed.data.query.trim();
  if (q.length < 2) {
    return { ok: true, data: [] };
  }
  // The types this user's access may read, denies included; search_global
  // keeps its role ceiling and only narrows to these.
  const types: string[] = SEARCH_ENTITY_TYPES.filter((t) =>
    userCan(ctx.access, ENTITY_READ_PERMISSION[t]),
  );
  if (types.length === 0) {
    return { ok: true, data: [] };
  }
  const supabase = await createClient();
  const limit = Math.min(parsed.data.limit ?? 20, 50);
  let { data, error } = await supabase.rpc("search_global", {
    p_query: q,
    p_limit: limit,
    p_types: types,
  });
  // Code deployed before the migration that adds p_types: search with the
  // old signature and filter here. Remove with the deny-loader tolerance in
  // lib/auth/denies.ts.
  if (error?.code === POSTGREST_FUNCTION_NOT_FOUND) {
    captureMessageOnce("search.global.legacy_rpc", "warn");
    ({ data, error } = await supabase.rpc("search_global", {
      p_query: q,
      p_limit: limit,
    }));
    data = (data ?? []).filter((row) => types.includes(row.entity_type));
  }
  if (error) {
    captureException(error, {
      op: "search.global.failed",
      userId: ctx.userId,
      queryLength: q.length,
    });
    return { ok: false, error: "Búsqueda falló." };
  }
  return { ok: true, data: data ?? [] };
}
