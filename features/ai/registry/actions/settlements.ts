import { z } from "zod";

import {
  listAllDriverSettlementsAction,
  listCodPendingAction,
} from "@/features/driver-settlements/actions/driver-settlements-actions";
import { formatDriverSettlementNumber } from "@/features/driver-settlements/schema";
import { listFreightSettlementsAction } from "@/features/freight-settlements/actions/freight-settlements-actions";
import {
  FREIGHT_SETTLEMENT_STATUSES,
  settlementDocumentLabel,
  settlementSide,
} from "@/features/freight-settlements/schema";
import { scopeIsFiscalFor } from "@/lib/auth/permissions";
import { ScopeInputSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { errResult, money, okResult } from "../result";
import { readScope } from "../scope";

// Liquidaciones de flete (documento R) and rendiciones de cobranza contra
// entrega. Each wraps the module's own gated list action.

const DEFAULT_LIMIT = 50;

export const getFreightSettlements = defineAiAction({
  name: "getFreightSettlements",
  domain: "ventas",
  permission: "invoices:read",
  sideEffect: "read",
  sources: ["freight_settlements", "freight_settlement_items"],
  description:
    "Liquidaciones de fletes: client, period, side (fiscal = Remito R then " +
    "a factura; internal = remito interno X), status (draft = borrador, " +
    "confirmed = remito R emitted but not invoiced yet, or internal waiting " +
    "for its X; invoiced = facturada or X issued; cancelled), its document " +
    "and total in ARS, newest first. For 'qué liquidaciones faltan " +
    "facturar' or a client's remito.",
  input: z.object({
    status: z.enum(FREIGHT_SETTLEMENT_STATUSES).optional(),
    client_name: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .optional()
      .describe("Part of the client's legal name."),
    scope: ScopeInputSchema,
    limit: z.number().int().min(1).max(200).optional(),
  }),
  run: async (ctx, input) => {
    const { isFiscal: requested, label } = readScope(input.scope);
    const isFiscal = scopeIsFiscalFor(ctx.access, requested);
    const res = await listFreightSettlementsAction();
    if (!res.ok) return errResult(res.error);
    const needle = input.client_name?.toLowerCase() ?? null;
    const rows = res.data.filter(
      (s) =>
        (input.status === undefined || s.status === input.status) &&
        (isFiscal === null ||
          settlementSide(s) === (isFiscal ? "fiscal" : "internal")) &&
        (needle === null || s.client_name.toLowerCase().includes(needle)),
    );
    const limit = input.limit ?? DEFAULT_LIMIT;
    const toInvoice = rows.filter((s) => s.status === "confirmed");
    return okResult(
      `${label}: ${rows.length} liquidaciones; ${toInvoice.length} confirmadas sin facturar por ${money(
        toInvoice.reduce((t, s) => t + s.total, 0),
      )}.`,
      {
        rows: rows.slice(0, limit).map((s) => ({
          id: s.id,
          document: settlementDocumentLabel(s),
          side: settlementSide(s),
          client_name: s.client_name,
          period_start: s.period_start,
          period_end: s.period_end,
          status: s.status,
          total_ars: s.total,
          invoice_status: s.invoice_status,
          invoicing_now: s.invoicing,
        })),
      },
      { partial: rows.length > limit },
    );
  },
});

export const getDriverSettlements = defineAiAction({
  name: "getDriverSettlements",
  domain: "tesoreria",
  permission: "receipts:read",
  sideEffect: "read",
  sources: [
    "driver_settlements",
    "driver_settlement_items",
    "driver_settlement_lines",
    "shipments",
  ],
  description:
    "Rendiciones de cobranza contra entrega: per driver, the delivered " +
    "cash-on-delivery cargas still to hand in (pending) and the rendiciones " +
    "(newest first) with what was expected, handed in, the difference " +
    "(negative = faltante), whether it was posted to the driver's account " +
    "and receipts cancelled or edited since. For 'qué choferes deben " +
    "rendir' or 'faltantes de rendición'.",
  input: z.object({
    driver_name: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .optional()
      .describe("Part of the driver's name."),
    only_with_difference: z
      .boolean()
      .optional()
      .describe("Only rendiciones with a faltante or sobrante."),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  run: async (_ctx, input) => {
    const pending = await listCodPendingAction();
    if (!pending.ok) return errResult(pending.error);

    const all = await listAllDriverSettlementsAction();
    if (!all.ok) return errResult(all.error);
    const { settlements, complete } = all.data;

    const needle = input.driver_name?.toLowerCase() ?? null;
    const byName = (name: string) =>
      needle === null || name.toLowerCase().includes(needle);
    const rows = settlements.filter(
      (s) =>
        byName(s.driver_name) &&
        (!input.only_with_difference || s.difference !== 0),
    );
    const limit = input.limit ?? DEFAULT_LIMIT;
    const owed = pending.data.byDriver.filter((d) => byName(d.driver_name));
    const shortfall = rows
      .filter((s) => s.status === "confirmed" && s.difference < 0)
      .reduce((t, s) => t - s.difference, 0);
    return okResult(
      `${owed.reduce((t, d) => t + d.cargas, 0)} cargas por rendir por ${money(
        owed.reduce((t, d) => t + d.amount, 0),
      )}; ${rows.length} rendiciones, faltante confirmado ${money(shortfall)}.`,
      {
        pending_by_driver: owed.map((d) => ({
          driver_name: d.driver_name,
          cargas: d.cargas,
          amount_ars: d.amount,
          drafts: d.drafts,
        })),
        settlements: rows.slice(0, limit).map((s) => ({
          id: s.id,
          number: formatDriverSettlementNumber(s.numero),
          driver_name: s.driver_name,
          date: s.settlement_date,
          status: s.status,
          cargas: s.cargas,
          expected_ars: s.expected_total,
          received_ars: s.received_total,
          difference_ars: s.difference,
          difference_posted_to_driver: s.difference_posted !== null,
          receipts: s.receipts.map((r) => r.label),
          receipts_out_of_sync: s.receipts_out_of_sync,
        })),
      },
      { partial: rows.length > limit || !complete },
    );
  },
});
