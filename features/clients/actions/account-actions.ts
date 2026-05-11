"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type AccountMovementSourceType = "invoice" | "receipt";

export interface AccountMovement {
  source_type: AccountMovementSourceType;
  source_id: string;
  movement_date: string;
  created_at: string;
  /** comprobante kind ('factura' | 'nc' | 'nd') or 'recibo' */
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number;
  /** Positive = el cliente debe (factura, ND). Negative = pago / NC. */
  signed_amount: number;
  /** Absolute value, useful when rendering "Debe" / "Haber" columns. */
  gross_amount: number;
  channel_id: string;
  channel_name: string;
  channel_division: string;
  channel_is_fiscal: boolean;
  /** Running balance after this row (sorted oldest → newest by movement_date,
   *  then created_at). */
  balance: number;
}

export interface ClientAccountResult {
  movements: AccountMovement[];
  /** Final running balance — last row's `balance`. Positive = cliente debe. */
  balance: number;
}

/**
 * Returns the chronological feed of comprobantes + recibos for a client
 * with a running balance computed in TS. The view filters by status
 * (`emitted` / `issued`) so cancelled / failed rows never appear.
 */
export async function getClientAccountAction(
  clientId: string,
): Promise<ActionResult<ClientAccountResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver clientes." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("v_client_account_movements")
    .select(
      "source_type, source_id, movement_date, created_at, kind, letter, punto_venta, numero, signed_amount, gross_amount, channel_id, channel_name, channel_division, channel_is_fiscal",
    )
    .eq("client_id", clientId)
    .order("movement_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("clients.account.list_failed", { clientId, error });
    return { ok: false, error: "No se pudo cargar la cuenta corriente." };
  }

  const rows = data ?? [];
  let running = 0;
  const movements: AccountMovement[] = [];
  for (const row of rows) {
    if (
      row.source_type == null ||
      row.source_id == null ||
      row.movement_date == null ||
      row.created_at == null ||
      row.kind == null ||
      row.punto_venta == null ||
      row.numero == null ||
      row.signed_amount == null ||
      row.gross_amount == null ||
      row.channel_id == null ||
      row.channel_name == null ||
      row.channel_division == null ||
      row.channel_is_fiscal == null
    ) {
      logger.warn("clients.account.row_with_nulls", { clientId, row });
      continue;
    }
    const signed = Number(row.signed_amount);
    running = Math.round((running + signed) * 100) / 100;
    movements.push({
      source_type: row.source_type as AccountMovementSourceType,
      source_id: row.source_id,
      movement_date: row.movement_date,
      created_at: row.created_at,
      kind: row.kind,
      letter: row.letter,
      punto_venta: row.punto_venta,
      numero: row.numero,
      signed_amount: signed,
      gross_amount: Number(row.gross_amount),
      channel_id: row.channel_id,
      channel_name: row.channel_name,
      channel_division: row.channel_division,
      channel_is_fiscal: row.channel_is_fiscal,
      balance: running,
    });
  }

  return { ok: true, data: { movements, balance: running } };
}
