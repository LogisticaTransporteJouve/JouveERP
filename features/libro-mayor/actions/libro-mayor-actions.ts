"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { IsoDateSchema, UuidSchema } from "@/lib/validation/common";

import type { LedgerRow } from "../schema";
import {
  LEDGER_MAX_ROWS,
  type LedgerResult,
} from "../lib/libro-mayor-pagination";

type ActionResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string };

const GetLedgerInput = z.object({
  accountId: UuidSchema,
  from: IsoDateSchema.nullable().optional(),
  to: IsoDateSchema.nullable().optional(),
});

export async function getLedgerAction(input: {
  accountId: string;
  from?: string | null;
  to?: string | null;
}): Promise<ActionResult<LedgerResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const parsed = GetLedgerInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Input inválido.",
    };
  }
  input = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_ledger", {
    p_account_id: input.accountId,
    p_date_from: input.from ?? undefined,
    p_date_to: input.to ?? undefined,
  });
  if (error) {
    logger.error("get_ledger.failed", {
      userId: ctx.userId,
      accountId: input.accountId,
      error,
    });
    return { ok: false, error: "No se pudo leer el libro mayor." };
  }
  const all = (data ?? []) as LedgerRow[];
  const truncated = all.length > LEDGER_MAX_ROWS;
  return {
    ok: true,
    data: {
      rows: truncated ? all.slice(0, LEDGER_MAX_ROWS) : all,
      truncated,
    },
  };
}
