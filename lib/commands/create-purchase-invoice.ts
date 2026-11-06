import "server-only";

import type { z } from "zod";

import type {
  PurchaseInvoiceCreateSchema,
  PurchaseInvoiceItemInput,
} from "@/features/purchase-invoices/schema";
import { logAudit } from "@/lib/actions/audit";
import { ivaIsComputable } from "@/lib/afip/codes";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { round2 } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

export const NON_COMPUTABLE_DENIED =
  "En facturas B y C el IVA, el exento y el no gravado van incluidos en el neto: cargá el IVA en 0 y, si hay ítems, con «Sin alícuota».";

type UserClient = Awaited<ReturnType<typeof createClient>>;

export type LetterAmounts = {
  channel_id: string;
  letter: string | null;
  imp_iva: number;
  imp_no_gravado: number;
  imp_op_exentas: number;
};

/** A fiscal B or C purchase books IVA, exento and no gravado inside the net
 *  (citi.ts declares IVA only for A). An old fiscal purchase without letter
 *  is left as it is. */
export async function carriesNonComputableAmounts(
  supabase: UserClient,
  v: LetterAmounts,
): Promise<boolean | { failed: unknown }> {
  if (v.letter === null || ivaIsComputable(v.letter)) return false;
  if (v.imp_iva + v.imp_no_gravado + v.imp_op_exentas === 0) return false;
  const { data, error } = await supabase
    .from("invoicing_channels")
    .select("is_fiscal")
    .eq("id", v.channel_id)
    .maybeSingle();
  if (error) return { failed: error };
  return data?.is_fiscal === true;
}

/** The IVA the purchase stores after a save: with items,
 *  replace_purchase_invoice_items rewrites imp_iva as the sum of the lines,
 *  whatever the header sent. */
export function storedIva(
  headerIva: number,
  items: readonly { line_iva: number }[] | undefined,
): number {
  if (!items || items.length === 0) return headerIva;
  return round2(items.reduce((a, it) => a + it.line_iva, 0));
}

export function itemsParam(items: PurchaseInvoiceItemInput[]) {
  return items.map((it, idx) => ({
    description: it.description,
    quantity: it.quantity,
    unit_price: it.unit_price,
    iva_rate_id: it.iva_rate_id,
    line_neto: it.line_neto,
    line_iva: it.line_iva,
    line_total: it.line_total,
    sort_order: it.sort_order ?? idx,
  }));
}

/**
 * Loads a purchase invoice (header and items in one transaction, through
 * create_purchase_invoice) and audits it. The caller has already checked
 * `purchase_invoices:write` (and `hr:write` when it is charged to an
 * employee) and parsed the input with PurchaseInvoiceCreateSchema: the
 * purchase form, the ARCA tray's accept and an accepted assistant proposal.
 *
 * It writes with the user's session client, not the service role: RLS on
 * purchase_invoices applies as before, and the triggers that post the entry
 * and the employee charge stamp `auth.uid()` as their author.
 */
export async function createPurchaseInvoice(
  actorId: string,
  d: z.output<typeof PurchaseInvoiceCreateSchema>,
  /** The voucher's AFIP code when it is a recibo or liquidación loaded as a
   *  factura (set by the ARCA tray's accept, never by the form). */
  opts: { cbteTipoAfip?: number | null } = {},
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();

  const nonComputable = await carriesNonComputableAmounts(supabase, {
    channel_id: d.channel_id,
    letter: d.letter ?? null,
    imp_iva: storedIva(d.imp_iva, d.items),
    imp_no_gravado: d.imp_no_gravado,
    imp_op_exentas: d.imp_op_exentas,
  });
  if (typeof nonComputable === "object") {
    logger.error("purchase_invoices.create.channel_failed", {
      userId: actorId,
      error: nonComputable.failed,
    });
    return { ok: false, error: "No se pudo cargar la factura." };
  }
  if (nonComputable) return { ok: false, error: NON_COMPUTABLE_DENIED };

  // An expense account (picked, a supplier default or AI-suggested) must be a
  // postable leaf: guard_expense_account rejects any other with a message.
  // The header and its items are one transaction: a refused item saves nothing.
  const { data: createdId, error } = await supabase.rpc(
    "create_purchase_invoice",
    {
      p_header: {
        channel_id: d.channel_id,
        account_id: d.account_id ?? null,
        cost_center_id: d.cost_center_id ?? null,
        charged_employee_id: d.charged_employee_id ?? null,
        supplier_id: d.supplier_id,
        kind: d.kind,
        letter: d.letter ?? null,
        punto_venta: d.punto_venta,
        numero: d.numero,
        fecha: d.fecha,
        fch_vto_pago: d.fch_vto_pago ?? null,
        imp_neto: d.imp_neto,
        imp_iva: d.imp_iva,
        imp_trib: d.imp_trib,
        imp_no_gravado: d.imp_no_gravado,
        imp_op_exentas: d.imp_op_exentas,
        imp_perc_iva: d.imp_perc_iva,
        imp_perc_nacionales: d.imp_perc_nacionales,
        imp_perc_iibb: d.imp_perc_iibb,
        imp_perc_municipales: d.imp_perc_municipales,
        imp_impuestos_internos: d.imp_impuestos_internos,
        imp_total: d.imp_total,
        moneda: d.moneda,
        cotizacion: d.cotizacion,
        cae_proveedor: d.cae_proveedor ?? null,
        cae_vto_proveedor: d.cae_vto_proveedor ?? null,
        invoice_origin_id: d.invoice_origin_id ?? null,
        motivo_nc_nd: d.motivo_nc_nd ?? null,
        ...(opts.cbteTipoAfip ? { cbte_tipo_afip: opts.cbteTipoAfip } : {}),
        notes: d.notes ?? null,
        created_by: actorId,
      },
      p_items: itemsParam(d.items ?? []),
    },
  );

  if (error || !createdId) {
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error:
          "Ya cargaste esta factura del proveedor (mismo tipo / letra / PV / número).",
      };
    }
    const guardError = mapDbGuardError(error, {
      slug: "purchase_invoices.create.rejected",
      userId: actorId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("purchase_invoices.create.failed", {
      userId: actorId,
      supplier_id: d.supplier_id,
      numero: d.numero,
      error,
    });
    return { ok: false, error: "No se pudo cargar la factura." };
  }
  await logAudit(
    "purchase_invoice.created",
    actorId,
    {
      supplier_id: d.supplier_id,
      kind: d.kind,
      numero: d.numero,
      imp_total: d.imp_total,
      items_count: d.items?.length ?? 0,
      account_id: d.account_id ?? null,
      cost_center_id: d.cost_center_id ?? null,
      charged_employee_id: d.charged_employee_id ?? null,
    },
    createdId,
  );
  return { ok: true, data: { id: createdId } };
}
