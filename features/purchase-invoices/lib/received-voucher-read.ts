import "server-only";

import { z } from "zod";

import { isIvaCondition } from "@/features/clients/schema";
import type { getServiceClient } from "@/lib/supabase/service";

import {
  PURCHASE_IVA_RATE_IDS,
  RECEIVED_VOUCHER_STATUSES,
  isPurchaseInvoiceStatus,
  type ReceivedVoucher,
} from "../schema";

// How the ARCA received tray reads its rows, shared by the tray's actions and
// the accept command (lib/commands/accept-received-voucher.ts). Every read
// goes through the service client after the caller's gate.

export type Service = ReturnType<typeof getServiceClient>;

export const VOUCHER_COLS =
  "id, issuer_cuit, issuer_name, cbte_tipo, kind, letter, punto_venta, numero, fecha, cae, moneda, cotizacion, imp_neto_gravado, imp_no_gravado, imp_op_exentas, imp_iva, imp_trib, imp_total, trib_breakdown, iva_breakdown, status, discard_reason, purchase_invoice_id, purchase_invoices(status, invoicing_channels(is_fiscal))";

const money = z.number();
export const RowSchema = z.object({
  id: z.string(),
  issuer_cuit: z.string(),
  issuer_name: z.string(),
  cbte_tipo: z.number(),
  kind: z.enum(["factura", "nc", "nd"]).nullable(),
  letter: z.enum(["A", "B", "C"]).nullable(),
  punto_venta: z.number(),
  numero: z.number(),
  fecha: z.string(),
  cae: z.string().nullable(),
  moneda: z.enum(["PES", "DOL"]),
  cotizacion: z.number().nullable(),
  imp_neto_gravado: money,
  imp_no_gravado: money,
  imp_op_exentas: money,
  imp_iva: money,
  imp_trib: money,
  imp_total: money,
  trib_breakdown: z
    .object({
      perc_iva: money.optional(),
      perc_nacionales: money.optional(),
      perc_iibb: money.optional(),
      municipales: money.optional(),
      internos: money.optional(),
    })
    .catch({}),
  iva_breakdown: z
    .array(
      z.object({
        iva_rate_id: z.literal(PURCHASE_IVA_RATE_IDS),
        neto: money,
        iva: money,
      }),
    )
    .catch([]),
  status: z.enum(RECEIVED_VOUCHER_STATUSES),
  discard_reason: z.string().nullable(),
  purchase_invoice_id: z.string().nullable(),
  purchase_invoices: z
    .object({
      status: z.string(),
      invoicing_channels: z.object({ is_fiscal: z.boolean() }).nullable(),
    })
    .nullable(),
});
export type Row = z.infer<typeof RowSchema>;

type SupplierById = Map<string, NonNullable<ReceivedVoucher["supplier"]>>;

export function toVoucher(row: Row, suppliers: SupplierById): ReceivedVoucher {
  const p = row.purchase_invoices;
  return {
    id: row.id,
    issuer_cuit: row.issuer_cuit,
    issuer_name: row.issuer_name,
    cbte_tipo: row.cbte_tipo,
    kind: row.kind,
    letter: row.letter,
    punto_venta: row.punto_venta,
    numero: row.numero,
    fecha: row.fecha,
    cae: row.cae,
    moneda: row.moneda,
    cotizacion: row.cotizacion,
    imp_neto_gravado: row.imp_neto_gravado,
    imp_no_gravado: row.imp_no_gravado,
    imp_op_exentas: row.imp_op_exentas,
    imp_iva: row.imp_iva,
    imp_trib: row.imp_trib,
    imp_total: row.imp_total,
    trib_breakdown: row.trib_breakdown,
    iva_breakdown: row.iva_breakdown,
    status: row.status,
    discard_reason: row.discard_reason,
    purchase:
      row.purchase_invoice_id && p && isPurchaseInvoiceStatus(p.status)
        ? {
            id: row.purchase_invoice_id,
            status: p.status,
            is_fiscal: p.invoicing_channels?.is_fiscal ?? false,
          }
        : null,
    supplier: suppliers.get(row.issuer_cuit) ?? null,
  };
}

/** The fiscal suppliers with these CUITs, by CUIT. */
export async function suppliersByCuit(
  supabase: Service,
  cuits: readonly string[],
): Promise<SupplierById | null> {
  const out: SupplierById = new Map();
  if (cuits.length === 0) return out;
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, legal_name, display_name, cuit, iva_condition")
    .in("cuit", [...new Set(cuits)])
    .eq("is_fiscal", true);
  if (error) return null;
  for (const s of data ?? []) {
    const { cuit, iva_condition: iva } = s;
    if (cuit === null || !isIvaCondition(iva)) continue;
    out.set(cuit, { ...s, cuit, iva_condition: iva });
  }
  return out;
}

export async function readVoucher(
  supabase: Service,
  voucherId: string,
): Promise<ReceivedVoucher | null | "failed"> {
  const { data, error } = await supabase
    .from("arca_received_vouchers")
    .select(VOUCHER_COLS)
    .eq("id", voucherId)
    .maybeSingle();
  if (error) return "failed";
  if (!data) return null;
  const row = RowSchema.safeParse(data);
  if (!row.success) return "failed";
  const suppliers = await suppliersByCuit(supabase, [row.data.issuer_cuit]);
  if (!suppliers) return "failed";
  return toVoucher(row.data, suppliers);
}
