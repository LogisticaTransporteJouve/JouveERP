import "server-only";

import type { z } from "zod";

import {
  arcaGapTargetLabel,
  placeReceivedGap,
  receivedVoucherAmounts,
  receivedVoucherGap,
  receivedVoucherItems,
} from "@/features/purchase-invoices/lib/arca-received-draft";
import {
  readVoucher,
  type Service,
} from "@/features/purchase-invoices/lib/received-voucher-read";
import {
  ARCA_GAP_TARGETS,
  PURCHASE_TRIBUTE_FIELDS,
  PurchaseInvoiceCreateSchema,
  type ArcaGapTarget,
  type ReceivedVoucher,
} from "@/features/purchase-invoices/schema";
import { logAudit } from "@/lib/actions/audit";
import { purchaseKeepsOwnCode } from "@/lib/afip/codes";
import { createWithClaim } from "@/lib/actions/claim";
import { formatMoney } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import { createPurchaseInvoice } from "./create-purchase-invoice";

export const ALREADY_PROCESSED = "Este comprobante ya fue procesado.";
export const BEING_LOADED =
  "Otra persona lo está cargando; probá en unos minutos.";
/** A claim older than this with no purchase was left by a crashed save. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;

export function arcaGapChoiceMessage(
  gap: number,
  voucher: Pick<ReceivedVoucher, "moneda" | "letter">,
): string {
  const amount = formatMoney(gap, voucher.moneda === "DOL" ? "USD" : "ARS");
  const choices = ARCA_GAP_TARGETS.map((t) =>
    arcaGapTargetLabel(t, voucher.letter).toLowerCase(),
  ).join(" o ");
  return `Los importes de ARCA no suman el total: elegí a dónde va la diferencia de ${amount} (${choices}).`;
}

type Invoice = z.output<typeof PurchaseInvoiceCreateSchema>;

/** Why the purchase sent does not match the voucher, or null when it does.
 *  Only the sum of the four tributes is checked: the split is the user's.
 *  The gap is the voucher's, recomputed here: only where it goes comes from
 *  the person. */
async function mismatch(
  supabase: Service,
  voucher: ReceivedVoucher,
  invoice: Invoice,
  gapTarget: ArcaGapTarget | null,
): Promise<string | null> {
  const { data: supplier, error } = await supabase
    .from("suppliers")
    .select("cuit")
    .eq("id", invoice.supplier_id)
    .maybeSingle();
  if (error) return "No se pudo leer el proveedor.";
  if (supplier?.cuit !== voucher.issuer_cuit) {
    return `El proveedor tiene que ser el de CUIT ${voucher.issuer_cuit}.`;
  }
  if (
    invoice.kind !== voucher.kind ||
    (invoice.letter ?? null) !== voucher.letter ||
    invoice.punto_venta !== voucher.punto_venta ||
    invoice.numero !== voucher.numero
  ) {
    return "El tipo, la letra y el número tienen que ser los de ARCA.";
  }
  if (
    invoice.fecha !== voucher.fecha ||
    invoice.moneda !== voucher.moneda ||
    (voucher.cae !== null && (invoice.cae_proveedor ?? null) !== voucher.cae)
  ) {
    return "La fecha, la moneda y el CAE tienen que ser los de ARCA.";
  }
  const { data: channel, error: channelError } = await supabase
    .from("invoicing_channels")
    .select("is_fiscal")
    .eq("id", invoice.channel_id)
    .maybeSingle();
  if (channelError) return "No se pudo leer el canal.";
  if (!channel?.is_fiscal)
    return "Un comprobante de ARCA va a un canal fiscal.";
  // ARCA's amounts did not read: the person types them.
  if (voucher.status === "unreadable") return null;

  const gap = receivedVoucherGap(voucher);
  if (gap !== null && gapTarget === null) {
    return arcaGapChoiceMessage(gap, voucher);
  }
  const arca = receivedVoucherAmounts(voucher);
  const want =
    gap !== null && gapTarget !== null
      ? placeReceivedGap(arca, voucher.letter, gap, gapTarget)
      : arca;
  const tributes = PURCHASE_TRIBUTE_FIELDS.reduce((a, f) => a + invoice[f], 0);
  const same =
    near(invoice.imp_neto, want.imp_neto) &&
    near(invoice.imp_no_gravado, want.imp_no_gravado) &&
    near(invoice.imp_op_exentas, want.imp_op_exentas) &&
    near(invoice.imp_iva, want.imp_iva) &&
    near(invoice.imp_trib, want.imp_trib) &&
    near(tributes, want.imp_trib) &&
    near(invoice.imp_total, want.imp_total);
  return same ? null : "Los importes tienen que ser los de ARCA.";
}

export type AcceptReceivedVoucherInput = {
  voucherId: string;
  invoice: Invoice;
  /** Where ARCA's total above its parts goes; only that, never the amount. */
  gapTarget: ArcaGapTarget | null;
};

/**
 * Loads an ARCA received voucher as a purchase: checks the purchase sent
 * against the voucher (supplier, number, date, currency, CAE, fiscal channel
 * and amounts, with the gap where the person put it), links it instead when
 * the purchase was loaded by hand meanwhile, refuses a cancelled one or one
 * with another total, and otherwise claims the voucher, creates the purchase
 * with ARCA's lines and confirms the voucher. A retry after a lost answer
 * returns the purchase already loaded.
 *
 * The caller has already checked `purchase_invoices:write` (and `hr:write`
 * when the purchase is charged to an employee) and parsed the input with
 * PurchaseInvoiceCreateSchema: the tray's accept dialog and an accepted
 * assistant proposal.
 */
export async function acceptReceivedVoucher(
  actorId: string,
  input: AcceptReceivedVoucherInput,
): Promise<ActionResult<{ id: string; linkedExisting: boolean }>> {
  const { voucherId, invoice, gapTarget } = input;
  const supabase = getServiceClient();
  const fail = (code: string) => {
    logger.error("arca_received.accept.failed", {
      userId: actorId,
      voucherId,
      code,
    });
    return { ok: false as const, error: "No se pudo cargar el comprobante." };
  };

  const voucher = await readVoucher(supabase, voucherId);
  if (voucher === "failed") return fail("read");
  // A retry after a save whose answer was lost: it is already loaded.
  if (voucher?.status === "confirmed" && voucher.purchase) {
    return {
      ok: true,
      data: { id: voucher.purchase.id, linkedExisting: true },
    };
  }
  if (
    !voucher ||
    (voucher.status !== "pending_review" && voucher.status !== "unreadable")
  ) {
    return { ok: false, error: ALREADY_PROCESSED };
  }
  const from = voucher.status;
  const unreadable = from === "unreadable";
  if (voucher.kind === null) {
    return {
      ok: false,
      error: "Este tipo de comprobante todavía se carga a mano desde Compras.",
    };
  }
  const wrong = await mismatch(supabase, voucher, invoice, gapTarget);
  if (wrong) return { ok: false, error: wrong };

  // Loaded by hand meanwhile: link it instead of creating a second one. The
  // link compares the amounts, which an unreadable voucher does not have:
  // the same-key check below links that one.
  if (!unreadable) {
    const { error: linkError } = await supabase.rpc("link_received_vouchers", {
      p_ids: [voucherId],
    });
    if (linkError) return fail(linkError.code);
  }
  const relinked = await readVoucher(supabase, voucherId);
  if (relinked === "failed") return fail("reread");
  if (relinked?.status === "confirmed" && relinked.purchase) {
    await logAudit(
      "purchase_invoice.arca_voucher_confirmed",
      actorId,
      {
        voucherId,
        purchaseInvoiceId: relinked.purchase.id,
        linkedExisting: true,
      },
      relinked.purchase.id,
    );
    return {
      ok: true,
      data: { id: relinked.purchase.id, linkedExisting: true },
    };
  }

  // Not linked above, so a fiscal purchase with this key (same letter, or an
  // old one without letter) is cancelled or has another total: creating a
  // second one would hide that.
  const { data: sameKey, error: sameKeyError } = await supabase
    .from("purchase_invoices")
    .select(
      "id, status, imp_total, suppliers!inner(cuit), invoicing_channels!inner(is_fiscal)",
    )
    .eq("suppliers.cuit", voucher.issuer_cuit)
    .eq("invoicing_channels.is_fiscal", true)
    .eq("kind", invoice.kind)
    .eq("punto_venta", voucher.punto_venta)
    .eq("numero", voucher.numero)
    .or(
      voucher.letter
        ? `letter.eq.${voucher.letter},letter.is.null`
        : "letter.is.null",
    )
    .limit(1);
  if (sameKeyError) return fail(sameKeyError.code);
  const existing = sameKey?.[0];
  if (existing?.status === "cancelled") {
    return { ok: false, error: "Ya existe esta factura anulada en Compras." };
  }
  if (existing && unreadable) {
    // ARCA's amounts did not read, so there is no total to compare: the
    // purchase already loaded with this number is the one.
    return confirmVoucher(
      supabase,
      actorId,
      voucherId,
      from,
      existing.id,
      true,
    );
  }
  if (existing) {
    return {
      ok: false,
      error: `Ya hay una compra con este número y otro total (${formatMoney(existing.imp_total)}): revisala antes de aceptar.`,
    };
  }

  // The lines are ARCA's (or none): client lines would recompute the amounts
  // just checked. Re-parsed, as the form's create would, with them.
  const withLines = PurchaseInvoiceCreateSchema.safeParse({
    ...invoice,
    // An unreadable voucher keeps the lines the person typed.
    items: unreadable ? invoice.items : receivedVoucherItems(voucher),
  });
  if (!withLines.success) {
    return {
      ok: false,
      error: withLines.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const created = await createWithClaim({
    claim: async () => {
      const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
      const { data, error } = await supabase
        .from("arca_received_vouchers")
        .update({
          claimed_at: new Date().toISOString(),
          reviewed_by: actorId,
        })
        .eq("id", voucherId)
        .eq("status", from)
        .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`)
        .select("id")
        .maybeSingle();
      if (error) {
        fail(error.code);
        return "failed";
      }
      return data !== null ? "won" : "lost";
    },
    release: async () => {
      const { error } = await supabase
        .from("arca_received_vouchers")
        .update({ claimed_at: null, reviewed_by: null })
        .eq("id", voucherId)
        .is("purchase_invoice_id", null);
      if (error) fail(error.code);
    },
    create: () =>
      createPurchaseInvoice(actorId, withLines.data, {
        // A recibo, liquidación or M keeps its own code for the Libro IVA TXT.
        cbteTipoAfip: purchaseKeepsOwnCode(voucher.cbte_tipo)
          ? voucher.cbte_tipo
          : null,
      }),
    alreadyProcessed: BEING_LOADED,
    claimFailed: "No se pudo cargar el comprobante.",
  });
  // A failed create saved nothing (header and items are one transaction) and
  // released the claim.
  if (!created.ok) return { ok: false, error: created.error };

  return confirmVoucher(
    supabase,
    actorId,
    voucherId,
    from,
    created.data.id,
    false,
  );
}

/** Marks the voucher loaded as that purchase and audits it. */
async function confirmVoucher(
  supabase: Service,
  actorId: string,
  voucherId: string,
  from: "pending_review" | "unreadable",
  purchaseId: string,
  linkedExisting: boolean,
): Promise<ActionResult<{ id: string; linkedExisting: boolean }>> {
  const { error: confirmError } = await supabase
    .from("arca_received_vouchers")
    .update({
      status: "confirmed",
      purchase_invoice_id: purchaseId,
      reviewed_by: actorId,
      reviewed_at: new Date().toISOString(),
      claimed_at: null,
    })
    .eq("id", voucherId)
    .or(
      `status.eq.${from},and(status.eq.confirmed,purchase_invoice_id.eq.${purchaseId})`,
    );
  // The trigger linked it already; this only stamps who reviewed it.
  if (confirmError) {
    logger.error("arca_received.accept.failed", {
      userId: actorId,
      voucherId,
      code: confirmError.code,
    });
    // Linking an existing purchase is all this call does: say it failed.
    if (linkedExisting) {
      return { ok: false, error: "No se pudo cargar el comprobante." };
    }
  }

  await logAudit(
    "purchase_invoice.arca_voucher_confirmed",
    actorId,
    { voucherId, purchaseInvoiceId: purchaseId, linkedExisting },
    purchaseId,
  );
  return { ok: true, data: { id: purchaseId, linkedExisting } };
}
