import "server-only";

import type { z } from "zod";

import type { AccountCreateSchema } from "@/features/accounts/schema";
import { logAudit } from "@/lib/actions/audit";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/** accounts_name_type_currency_active_idx: lower(name), type and currency
 *  are unique among active accounts. */
export const DUPLICATE_ACCOUNT =
  "Ya existe una cuenta con ese nombre, tipo y moneda.";

/** Whether an active account already holds that name (case-insensitive, as
 *  the unique index's lower()), type and currency. */
export function isDuplicateAccount(
  existing: readonly {
    name: string;
    type: string;
    currency: string;
    is_active: boolean;
  }[],
  d: { name: string; type: string; currency: string },
): boolean {
  const name = d.name.toLowerCase();
  return existing.some(
    (a) =>
      a.is_active &&
      a.type === d.type &&
      a.currency === d.currency &&
      a.name.toLowerCase() === name,
  );
}

/**
 * Creates a treasury account (Tesorería › Cuentas › «Nueva cuenta») and
 * audits it. The caller has already checked `accounts:write` and parsed the
 * input with AccountCreateSchema: the account form and an accepted assistant
 * proposal. It writes with the user's session client, as the form always
 * did: RLS on accounts applies.
 */
export async function createAccount(
  actorId: string,
  d: z.output<typeof AccountCreateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      name: d.name,
      type: d.type,
      currency: d.currency,
      opening_balance: d.opening_balance,
      notes: d.notes ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: DUPLICATE_ACCOUNT };
    }
    logger.error("accounts.create.failed", {
      userId: actorId,
      name: d.name,
      type: d.type,
      error,
    });
    return { ok: false, error: "No se pudo crear la cuenta." };
  }

  await logAudit(
    "account.created",
    actorId,
    { name: d.name, type: d.type, currency: d.currency },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}
