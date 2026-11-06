import "server-only";

import type { z } from "zod";

import type { SupplierCreateSchema } from "@/features/suppliers/schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

export const DUPLICATE_SUPPLIER_CUIT = "Ya existe un proveedor con ese CUIT.";

/**
 * Creates a supplier (Compras with CUIT and IVA condition, or Otras compras
 * with neither) and audits it. The caller has already checked
 * `suppliers:write` and parsed the input with SupplierCreateSchema: the
 * supplier form and an accepted assistant proposal. It writes with the
 * user's session client, as the form always did: RLS on suppliers applies.
 */
export async function createSupplier(
  actorId: string,
  d: z.output<typeof SupplierCreateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      is_fiscal: d.is_fiscal,
      cuit: d.is_fiscal ? d.cuit : null,
      legal_name: d.legal_name,
      display_name: d.display_name ?? null,
      iva_condition: d.is_fiscal ? d.iva_condition : null,
      email: d.email ?? null,
      phone: d.phone ?? null,
      address: d.is_fiscal ? (d.address ?? null) : null,
      real_address: d.real_address ?? null,
      notes: d.notes ?? null,
      default_channel_id: d.default_channel_id ?? null,
      default_payment_term_days: d.default_payment_term_days ?? null,
      category_id: d.category_id ?? null,
      default_expense_account_id: d.default_expense_account_id ?? null,
      default_cost_center_id: d.default_cost_center_id ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: DUPLICATE_SUPPLIER_CUIT };
    }
    const guardError = mapDbGuardError(error, {
      slug: "suppliers.create.rejected",
      userId: actorId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("suppliers.create.failed", {
      userId: actorId,
      cuit: d.is_fiscal ? d.cuit : null,
      error,
    });
    return { ok: false, error: "No se pudo crear el proveedor." };
  }

  await logAudit(
    "supplier.created",
    actorId,
    { cuit: d.is_fiscal ? d.cuit : null, legal_name: d.legal_name },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}
