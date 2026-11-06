import "server-only";

import type { TransactionCreateInput } from "@/features/transactions/schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/**
 * Registers a manual income or expense (Caja › Nuevo movimiento) with the
 * caller's session, then audits it. A check account is refused: its
 * movements come from /checks. The caller has already checked
 * `transactions:write` and parsed the input with `TransactionCreateSchema`:
 * the Caja form and an accepted assistant proposal.
 */
export async function createTransaction(
  actorId: string,
  data: TransactionCreateInput,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();

  // Accounts of type checks/echeq are handled exclusively from
  // /checks (manual entry, deposit, endorsement, crediting). We block
  // manual ins/outs against those accounts to avoid drift
  // between the check portfolio and the cash register.
  const { data: acc, error: accErr } = await supabase
    .from("accounts")
    .select("type")
    .eq("id", data.account_id)
    .maybeSingle();
  if (accErr) {
    logger.error("transactions.create.account_read_failed", {
      userId: actorId,
      error: accErr,
    });
    return { ok: false, error: "No se pudo leer la cuenta." };
  }
  if (!acc) return { ok: false, error: "Cuenta no encontrada." };
  if (acc.type === "checks" || acc.type === "echeq") {
    return {
      ok: false,
      error:
        "Los movimientos en cuentas de cheques se manejan desde /checks (cargar, depositar, endosar).",
    };
  }

  const { data: row, error } = await supabase
    .from("transactions")
    .insert({
      account_id: data.account_id,
      channel_id: data.channel_id,
      kind: data.kind,
      amount: data.amount,
      currency: data.currency,
      transaction_date: data.transaction_date,
      accrual_month: data.accrual_month,
      description: data.description ?? null,
      invoice_id: data.invoice_id ?? null,
      counterparty_client_id: data.counterparty_client_id ?? null,
      expense_account_id: data.expense_account_id ?? null,
      cost_center_id: data.cost_center_id ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "transactions.create.rejected",
      userId: actorId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("transactions.create.failed", { userId: actorId, error });
    return { ok: false, error: "No se pudo registrar el movimiento." };
  }

  await logAudit(
    "transaction.created",
    actorId,
    {
      kind: data.kind,
      amount: data.amount,
      account_id: data.account_id,
      channel_id: data.channel_id,
      expense_account_id: data.expense_account_id ?? null,
      cost_center_id: data.cost_center_id ?? null,
    },
    row.id,
  );
  return { ok: true, data: { id: row.id } };
}
