import "server-only";

import type { z } from "zod";

import type { SupplierUpdateSchema } from "@/features/suppliers/schema";
import { logAudit, type JsonValue } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

import { DUPLICATE_SUPPLIER_CUIT } from "./create-supplier";

/**
 * Writes the supplier fields present in the input (an absent key keeps the
 * stored value) and audits which ones. The caller has already checked
 * `suppliers:write` and parsed the input with SupplierUpdateSchema: the
 * supplier form and an accepted assistant proposal. It writes with the
 * user's session client, as the form always did: RLS on suppliers applies.
 */
export async function updateSupplier(
  actorId: string,
  input: z.output<typeof SupplierUpdateSchema>,
): Promise<ActionResult> {
  const { id, ...rest } = input;

  const supabase = await createClient();
  const { data: changed, error } = await supabase
    .from("suppliers")
    .update({
      ...(rest.cuit !== undefined && { cuit: rest.cuit }),
      ...(rest.legal_name !== undefined && { legal_name: rest.legal_name }),
      ...(rest.display_name !== undefined && {
        display_name: rest.display_name ?? null,
      }),
      ...(rest.iva_condition !== undefined && {
        iva_condition: rest.iva_condition,
      }),
      ...(rest.email !== undefined && { email: rest.email ?? null }),
      ...(rest.phone !== undefined && { phone: rest.phone ?? null }),
      ...(rest.address !== undefined && { address: rest.address ?? null }),
      ...(rest.real_address !== undefined && {
        real_address: rest.real_address ?? null,
      }),
      ...(rest.notes !== undefined && { notes: rest.notes ?? null }),
      ...(rest.default_channel_id !== undefined && {
        default_channel_id: rest.default_channel_id ?? null,
      }),
      ...(rest.default_payment_term_days !== undefined && {
        default_payment_term_days: rest.default_payment_term_days ?? null,
      }),
      ...(rest.category_id !== undefined && {
        category_id: rest.category_id ?? null,
      }),
      ...(rest.default_expense_account_id !== undefined && {
        default_expense_account_id: rest.default_expense_account_id ?? null,
      }),
      ...(rest.default_cost_center_id !== undefined && {
        default_cost_center_id: rest.default_cost_center_id ?? null,
      }),
    })
    .eq("id", id)
    .select("id");

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: DUPLICATE_SUPPLIER_CUIT };
    }
    const guardError = mapDbGuardError(error, {
      slug: "suppliers.update.rejected",
      userId: actorId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("suppliers.update.failed", { userId: actorId, id, error });
    return { ok: false, error: "No se pudo actualizar el proveedor." };
  }
  if (!changed || changed.length === 0) {
    return { ok: false, error: "No se encontró el proveedor." };
  }

  await logAudit(
    "supplier.updated",
    actorId,
    { fields: Object.keys(rest) as JsonValue[] },
    id,
  );
  return { ok: true, data: undefined };
}
