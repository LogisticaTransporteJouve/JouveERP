import { z } from "zod";

import { getPalletsSummaryAction } from "@/features/pallets/actions/pallets-summary-actions";
import { listProductsAction } from "@/features/products/actions/products-actions";
import {
  getStorageBillingAction,
  listStorageBillingRunsAction,
} from "@/features/storage-billing/actions/billing-actions";
import { listStorageTariffsAction } from "@/features/storage-tariffs/actions/storage-tariffs-actions";
import { listWarehousesAction } from "@/features/warehouses/actions/warehouses-actions";
import { IsoDateSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { errResult, money, okResult } from "../result";

// Warehouse / storage reads. Each wraps a gated read action
// (warehouses / products / pallets / storage_billing :read).

export const getPalletsSummary = defineAiAction({
  name: "getPalletsSummary",
  domain: "deposito",
  permission: "pallets:read",
  sideEffect: "read",
  sources: ["ai_pallets_summary", "pallets"],
  description:
    "Stock actual de pallets por depósito y cliente (pallets y unidades en depósito) y movimiento de los últimos 30 días (ingresos y egresos). Sin parámetros.",
  input: z.object({}),
  run: async () => {
    const res = await getPalletsSummaryAction();
    if (!res.ok) return errResult(res.error);
    const inStock = res.data.reduce((s, r) => s + r.in_stock, 0);
    return okResult(
      `${inStock} pallets en depósito en ${
        new Set(res.data.map((r) => r.warehouse_id)).size
      } depósitos.`,
      { rows: res.data },
    );
  },
});

export const getWarehouses = defineAiAction({
  name: "getWarehouses",
  domain: "deposito",
  permission: "warehouses:read",
  sideEffect: "read",
  sources: ["warehouses"],
  description: "Depósitos: nombre, dirección, capacidad en pallets y estado.",
  input: z.object({
    onlyActive: z.boolean().nullish().describe("Solo activos (default false)."),
  }),
  run: async (_ctx, input) => {
    const res = await listWarehousesAction({
      onlyActive: input.onlyActive ?? false,
    });
    if (!res.ok) return errResult(res.error);
    return okResult(`${res.data.length} depósitos.`, res.data);
  },
});

export const getProducts = defineAiAction({
  name: "getProducts",
  domain: "deposito",
  permission: "products:read",
  sideEffect: "read",
  sources: ["products"],
  description:
    "Productos almacenados por cliente: nombre, SKU, unidad y estado. Sin parámetros.",
  input: z.object({}),
  run: async () => {
    const res = await listProductsAction();
    if (!res.ok) return errResult(res.error);
    return okResult(`${res.data.length} productos.`, res.data, {
      partial: res.data.length >= 1000,
    });
  },
});

export const getStorageTariffs = defineAiAction({
  name: "getStorageTariffs",
  domain: "deposito",
  permission: "storage_billing:read",
  sideEffect: "read",
  sources: ["storage_tariffs"],
  description:
    "Tarifas de almacenaje por cliente: precio por pallet, período, cargos de ingreso/egreso y vigencia. Sin parámetros.",
  input: z.object({}),
  run: async () => {
    const res = await listStorageTariffsAction();
    if (!res.ok) return errResult(res.error);
    const active = res.data.filter((t) => t.is_active).length;
    return okResult(
      `${res.data.length} tarifas (${active} activas).`,
      res.data,
    );
  },
});

export const getStorageBilling = defineAiAction({
  name: "getStorageBilling",
  domain: "deposito",
  permission: "storage_billing:read",
  sideEffect: "read",
  sources: ["pallets", "storage_tariffs", "clients"],
  description:
    "Facturación de almacenaje calculada para un rango de fechas: por cliente pallets y cargo, total de almacenaje y movimientos, y pallets sin tarifa.",
  input: z
    .object({
      periodStart: IsoDateSchema.describe("Fecha desde, YYYY-MM-DD."),
      periodEnd: IsoDateSchema.describe("Fecha hasta, YYYY-MM-DD (inclusive)."),
    })
    .refine((v) => v.periodStart <= v.periodEnd, "Rango de fechas invertido."),
  run: async (_ctx, input) => {
    const res = await getStorageBillingAction(input);
    if (!res.ok) return errResult(res.error);
    const d = res.data;
    return okResult(
      `Almacenaje ${input.periodStart}→${input.periodEnd}: ${money(d.total)} ` +
        `(almacenaje ${money(d.storage_total)} + movimientos ${money(d.handling_total)}) · ` +
        `${d.byClient.length} clientes · ${d.pallets_without_tariff} pallets sin tarifa.`,
      {
        byClient: d.byClient,
        totals: {
          total: d.total,
          storage_total: d.storage_total,
          handling_total: d.handling_total,
        },
        pallets_without_tariff: d.pallets_without_tariff,
      },
      { currency: "ARS" },
    );
  },
});

export const getStorageBillingRuns = defineAiAction({
  name: "getStorageBillingRuns",
  domain: "deposito",
  permission: "storage_billing:read",
  sideEffect: "read",
  sources: ["storage_billing_runs"],
  description:
    "Historial de liquidaciones de almacenaje ya generadas: cliente, período, totales y factura asociada. Sin parámetros.",
  input: z.object({}),
  run: async () => {
    const res = await listStorageBillingRunsAction();
    if (!res.ok) return errResult(res.error);
    const pending = res.data.filter((r) => r.invoice_id === null).length;
    return okResult(
      `${res.data.length} liquidaciones de almacenaje (${pending} sin facturar).`,
      res.data,
      { currency: "ARS", partial: res.data.length >= 1000 },
    );
  },
});
