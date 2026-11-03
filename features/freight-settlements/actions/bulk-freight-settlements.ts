"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { round2 } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { formatRemitoR } from "../schema";
import {
  FreightBulkSchema,
  MAX_BULK_CLIENTS,
  type FreightBulkInput,
  type FreightBulkResult,
} from "../lib/bulk";

/**
 * "Liquidar período": one draft liquidación per client with delivered,
 * uninvoiced cargas in the period that are in no live liquidación, each
 * with every such carga that has a price (its flete or the client's flete
 * tariff). Drafts only: each is reviewed and confirmed one by one. Running
 * it again creates nothing for a client whose cargas are already in a draft
 * (the candidates leave them out), so it does not duplicate. One client
 * failing does not stop the rest.
 */
export async function createFreightSettlementsBulkAction(
  input: FreightBulkInput,
): Promise<ActionResult<FreightBulkResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:issue")) {
    return { ok: false, error: "No tenés permiso para liquidar fletes." };
  }
  const parsed = FreightBulkSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { period_start, period_end, confirm = false } = parsed.data;
  const supabase = getServiceClient();

  // Clients with a delivered, uninvoiced carga in the period (service date =
  // delivery date, else scheduled date, as freight_settlement_candidates).
  const ships = await paginateRange((from, to) =>
    supabase
      .from("shipments")
      .select("client_id, client:clients(legal_name)")
      .eq("status", "delivered")
      .is("invoice_id", null)
      .not("client_id", "is", null)
      .or(
        `and(delivery_date.gte.${period_start},delivery_date.lte.${period_end}),and(delivery_date.is.null,scheduled_date.gte.${period_start},scheduled_date.lte.${period_end})`,
      )
      .order("id")
      .range(from, to),
  );
  if (ships.error) {
    logger.error("freight_settlements.bulk.read_failed", {
      userId: ctx.userId,
      error: ships.error,
    });
    return { ok: false, error: "No se pudieron leer las cargas del período." };
  }
  const clients = new Map<string, string>();
  for (const s of ships.data) {
    if (s.client_id) clients.set(s.client_id, s.client?.legal_name ?? "—");
  }
  if (clients.size > MAX_BULK_CLIENTS) {
    return {
      ok: false,
      error: `Hay ${clients.size} clientes con cargas: liquidá un período más corto (hasta ${MAX_BULK_CLIENTS}).`,
    };
  }

  const result: FreightBulkResult = { created: [], skipped: [] };
  const ordered = [...clients.entries()].sort((a, b) =>
    a[1].localeCompare(b[1], "es"),
  );
  for (const [clientId, clientName] of ordered) {
    const candidates = await paginateRange((from, to) =>
      supabase
        .rpc("freight_settlement_candidates", {
          p_client_id: clientId,
          p_period_start: period_start,
          p_period_end: period_end,
        })
        .range(from, to),
    );
    if (candidates.error) {
      logger.error("freight_settlements.bulk.candidates_failed", {
        userId: ctx.userId,
        clientId,
        error: candidates.error,
      });
      result.skipped.push({
        client_name: clientName,
        reason: "No se pudieron leer sus cargas.",
      });
      continue;
    }
    const priced = candidates.data.filter(
      (c) => c.amount !== null && Number(c.amount) > 0,
    );
    const unpriced = candidates.data.length - priced.length;
    if (priced.length === 0) {
      if (candidates.data.length > 0) {
        result.skipped.push({
          client_name: clientName,
          reason: `${unpriced === 1 ? "1 carga" : `${unpriced} cargas`} sin flete ni tarifa de flete.`,
        });
      }
      continue;
    }

    const { data: id, error } = await supabase.rpc("save_freight_settlement", {
      p_client_id: clientId,
      p_period_start: period_start,
      p_period_end: period_end,
      p_shipment_ids: priced.map((c) => c.shipment_id),
      p_notes: "",
      p_user_id: ctx.userId,
    });
    if (error || !id) {
      const guard = mapDbGuardError(error, {
        slug: "freight_settlements.bulk.rejected",
        userId: ctx.userId,
        id: clientId,
      });
      if (!guard) {
        logger.error("freight_settlements.bulk.save_failed", {
          userId: ctx.userId,
          clientId,
          error,
        });
      }
      result.skipped.push({
        client_name: clientName,
        reason: guard ?? "No se pudo crear la liquidación.",
      });
      continue;
    }
    let remito: string | null = null;
    let confirmError: string | null = null;
    if (confirm) {
      // The same confirmation as "Confirmar" (#331): fiscal → Remito R.
      const confirmed = await supabase
        .rpc("confirm_freight_settlement_document", {
          p_settlement_id: id,
          p_user_id: ctx.userId,
        })
        .maybeSingle();
      if (confirmed.error || !confirmed.data) {
        confirmError =
          mapDbGuardError(confirmed.error, {
            slug: "freight_settlements.bulk.confirm_rejected",
            userId: ctx.userId,
            id,
          }) ?? "No se pudo confirmar: quedó en borrador.";
        if (!confirmed.error?.hint) {
          logger.error("freight_settlements.bulk.confirm_failed", {
            userId: ctx.userId,
            id,
            error: confirmed.error,
          });
        }
      } else if (
        confirmed.data.remito_pos !== null &&
        confirmed.data.remito_number !== null
      ) {
        remito = formatRemitoR(
          confirmed.data.remito_pos,
          confirmed.data.remito_number,
        );
      }
    }
    result.created.push({
      id,
      client_name: clientName,
      cargas: priced.length,
      total: round2(priced.reduce((t, c) => t + Number(c.amount), 0)),
      unpriced,
      remito,
      confirm_error: confirmError,
    });
  }

  if (result.created.length > 0) {
    await logAudit("freight_settlement.bulk_created", ctx.userId, {
      period_start,
      period_end,
      created: result.created.length,
      skipped: result.skipped.length,
      confirm,
      ids: result.created.map((c) => c.id),
      remitos: result.created
        .map((c) => c.remito)
        .filter((r): r is string => r !== null),
    });
  }
  return { ok: true, data: result };
}
