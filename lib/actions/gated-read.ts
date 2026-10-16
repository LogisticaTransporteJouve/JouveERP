import "server-only";

import type { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { userCan, type Permission } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

type UserClient = Awaited<ReturnType<typeof createClient>>;

type RowsResponse<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/**
 * The body of a read server action over a security-invoker RPC or view, in
 * the house order: session → every permission in `permissions` → Zod parse of
 * the untrusted input → RLS user client. Errors are logged under `event` and
 * returned as `failure`; the caller's `query` never runs for a denied or
 * invalid call.
 */
export async function gatedRead<S extends z.ZodType, T>(options: {
  permissions: readonly Permission[];
  denied: string;
  schema: S;
  input: unknown;
  event: string;
  failure: string;
  query: (
    supabase: UserClient,
    input: z.output<S>,
  ) => PromiseLike<RowsResponse<T>>;
}): Promise<ActionResult<T[]>> {
  const ctx = await requireUserContext();
  if (!options.permissions.every((p) => userCan(ctx.roles, p))) {
    return { ok: false, error: options.denied };
  }
  const parsed = options.schema.safeParse(options.input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const supabase = await createClient();
  const { data, error } = await options.query(supabase, parsed.data);
  if (error) {
    logger.error(options.event, { userId: ctx.userId, error });
    return { ok: false, error: options.failure };
  }
  return { ok: true, data: data ?? [] };
}
