"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { isFiscalOnly, userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import { formatInvoiceNumber } from "../schema";

const ImputeInput = z.object({
  factura_id: z.string().uuid(),
  remito_ids: z.array(z.string().uuid()).min(1).max(50),
});

/**
 * Imputes remitos internos de compra to a fiscal purchase factura
 * (impute_purchase_remitos, docs/otras-ventas.md §6): each remito is credited
 * with an NC interna and its payment orders pass to the factura. It moves
 * payment orders, so it needs both write permissions.
 */
export async function imputePurchaseRemitosAction(
  input: unknown,
): Promise<ActionResult<{ nc_ids: string[] }>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.access, "purchase_invoices:write") ||
    !userCan(ctx.access, "payment_orders:write")
  ) {
    return {
      ok: false,
      error: "No tenés permiso para imputar remitos a una factura.",
    };
  }
  const parsed = ImputeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("impute_purchase_remitos", {
    p_factura_id: parsed.data.factura_id,
    p_remito_ids: parsed.data.remito_ids,
    p_user_id: ctx.userId,
  });
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "purchase_invoices.impute.rejected",
      userId: ctx.userId,
      id: parsed.data.factura_id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("purchase_invoices.impute.failed", {
      userId: ctx.userId,
      id: parsed.data.factura_id,
      error,
    });
    return { ok: false, error: "No se pudieron imputar los remitos." };
  }

  await logAudit(
    "purchase_invoice.remitos_imputed",
    ctx.userId,
    { remito_ids: parsed.data.remito_ids },
    parsed.data.factura_id,
  );
  return { ok: true, data: { nc_ids: data ?? [] } };
}

export type ImputableRemito = {
  id: string;
  label: string;
  fecha: string;
  imp_total: number;
  /** Paid by internal payment orders: they pass to the factura. */
  paid: number;
  /** Why it cannot be imputed (purchase_remito_blocker), or null. */
  blocker: string | null;
};

/** An internal supplier's remitos that can still be imputed: received,
 *  in pesos, with nothing credited yet. */
export async function listImputableRemitosAction(
  supplierId: string,
): Promise<ActionResult<ImputableRemito[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const id = z.string().uuid().safeParse(supplierId);
  if (!id.success) return { ok: false, error: "Proveedor inválido." };

  const supabase = getServiceClient();
  const channels = await supabase
    .from("invoicing_channels")
    .select("id")
    .eq("is_fiscal", false);
  if (channels.error) {
    logger.error("purchase_invoices.imputable.failed", {
      userId: ctx.userId,
      error: channels.error,
    });
    return { ok: false, error: "No se pudieron leer los remitos." };
  }
  const internal = (channels.data ?? []).map((c) => c.id);
  if (internal.length === 0) return { ok: true, data: [] };

  const { data, error } = await supabase
    .from("v_purchase_invoice_open")
    .select("purchase_invoice_id, imp_total, amount_paid, open_amount")
    .eq("supplier_id", id.data)
    .in("channel_id", internal)
    .eq("kind", "factura")
    .eq("status", "received")
    .eq("moneda", "PES")
    .eq("amount_credited_by_nc", 0)
    .eq("amount_opening_applied", 0)
    .limit(200);
  if (error) {
    logger.error("purchase_invoices.imputable.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron leer los remitos." };
  }
  const ids = (data ?? []).flatMap((r) =>
    r.purchase_invoice_id ? [r.purchase_invoice_id] : [],
  );
  if (ids.length === 0) return { ok: true, data: [] };

  const docs = await supabase
    .from("purchase_invoices")
    .select("id, kind, letter, punto_venta, numero, fecha")
    .in("id", ids)
    .order("fecha", { ascending: true });
  if (docs.error) {
    logger.error("purchase_invoices.imputable.failed", {
      userId: ctx.userId,
      error: docs.error,
    });
    return { ok: false, error: "No se pudieron leer los remitos." };
  }
  const blockers = await supabase.rpc("purchase_remito_blockers", {
    p_remito_ids: ids,
  });
  if (blockers.error) {
    logger.error("purchase_invoices.imputable.failed", {
      userId: ctx.userId,
      error: blockers.error,
    });
    return { ok: false, error: "No se pudieron leer los remitos." };
  }
  const blockerById = new Map(
    (blockers.data ?? []).map((b) => [b.remito_id, b.blocker]),
  );
  const openById = new Map((data ?? []).map((r) => [r.purchase_invoice_id, r]));
  return {
    ok: true,
    data: (docs.data ?? []).map((d) => {
      const open = openById.get(d.id);
      return {
        id: d.id,
        label: formatInvoiceNumber(d),
        fecha: d.fecha,
        imp_total: Number(open?.imp_total ?? 0),
        paid: Number(open?.amount_paid ?? 0),
        blocker: blockerById.get(d.id) ?? null,
      };
    }),
  };
}

export type PurchaseImputations = {
  /** On a factura: the remitos imputed to it, with the NC that credits each. */
  remitos: Array<{ id: string; label: string; nc_id: string; amount: number }>;
  /** On a remito: the factura it is imputed to, and what the NC credits. */
  imputedTo: { id: string; label: string; credited: number } | null;
};

export async function getPurchaseImputationsAction(
  invoiceId: string,
): Promise<ActionResult<PurchaseImputations>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:read")) {
    return { ok: false, error: "No tenés permiso." };
  }
  const id = z.string().uuid().safeParse(invoiceId);
  if (!id.success) return { ok: false, error: "Comprobante inválido." };
  // The remitos are internal: a fiscal-only user does not see them.
  if (isFiscalOnly(ctx.access)) {
    return { ok: true, data: { remitos: [], imputedTo: null } };
  }

  const supabase = getServiceClient();
  const cols = "id, imp_total, invoice_origin_id, imputed_to_id, status";
  const [onFactura, onRemito] = await Promise.all([
    supabase
      .from("purchase_invoices")
      .select(cols)
      .eq("imputed_to_id", id.data)
      .eq("status", "received"),
    supabase
      .from("purchase_invoices")
      .select(cols)
      .eq("invoice_origin_id", id.data)
      .not("imputed_to_id", "is", null)
      .eq("status", "received")
      .maybeSingle(),
  ]);
  const failed = onFactura.error ?? onRemito.error;
  if (failed) {
    logger.error("purchase_invoices.imputations.failed", {
      userId: ctx.userId,
      id: id.data,
      error: failed,
    });
    return { ok: false, error: "No se pudieron leer las imputaciones." };
  }

  const linked = [
    ...(onFactura.data ?? []).flatMap((n) =>
      n.invoice_origin_id ? [n.invoice_origin_id] : [],
    ),
    ...(onRemito.data?.imputed_to_id ? [onRemito.data.imputed_to_id] : []),
  ];
  const labels = new Map<string, string>();
  if (linked.length > 0) {
    const docs = await supabase
      .from("purchase_invoices")
      .select("id, kind, letter, punto_venta, numero")
      .in("id", linked);
    if (docs.error) {
      logger.error("purchase_invoices.imputations.failed", {
        userId: ctx.userId,
        id: id.data,
        error: docs.error,
      });
      return { ok: false, error: "No se pudieron leer las imputaciones." };
    }
    for (const d of docs.data ?? []) labels.set(d.id, formatInvoiceNumber(d));
  }

  return {
    ok: true,
    data: {
      remitos: (onFactura.data ?? []).flatMap((n) =>
        n.invoice_origin_id
          ? [
              {
                id: n.invoice_origin_id,
                label: labels.get(n.invoice_origin_id) ?? "",
                nc_id: n.id,
                amount: Number(n.imp_total),
              },
            ]
          : [],
      ),
      imputedTo: onRemito.data?.imputed_to_id
        ? {
            id: onRemito.data.imputed_to_id,
            label: labels.get(onRemito.data.imputed_to_id) ?? "",
            credited: Number(onRemito.data.imp_total),
          }
        : null,
    },
  };
}
