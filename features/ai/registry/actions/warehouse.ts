import { z } from "zod";

import { listPalletsAction } from "@/features/pallets/actions/pallets-actions";
import { getPalletsSummaryAction } from "@/features/pallets/actions/pallets-summary-actions";
import { PALLET_STATUSES } from "@/features/pallets/schema";
import { listProductsAction } from "@/features/products/actions/products-actions";
import { listWarehousesAction } from "@/features/warehouses/actions/warehouses-actions";
import { IsoDateSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { errResult, okResult, reachedCap } from "../result";

// Warehouse / storage reads. Each wraps a gated read action
// (warehouses / products / pallets :read).

const PALLETS_DEFAULT = 100;
const PALLETS_MAX = 500;

/** Lower case without accents, for a contains match on names and codes. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export const getPallets = defineAiAction({
  name: "getPallets",
  domain: "deposito",
  permission: "pallets:read",
  sideEffect: "read",
  sources: ["pallets"],
  description:
    "Trazabilidad de pallets (la página Trazabilidad): cada pallet con código, cliente, depósito, área, producto, cantidad, lote y vencimiento, fecha de ingreso y de egreso, estado y bloqueo. Filtrable por cliente (nombre), código o lote, estado (en_deposito/despachado) y rango de fecha de ingreso; los más nuevos primero. Para '¿dónde está el pallet X?' o '¿qué pallets de tal cliente salieron en octubre?'. El stock total está en getPalletsSummary.",
  input: z.object({
    client: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullish()
      .describe("Cliente: nombre o parte."),
    code: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .nullish()
      .describe("Código del pallet o número de lote (o parte)."),
    status: z.enum(PALLET_STATUSES).nullish().describe("Estado."),
    from: IsoDateSchema.nullish().describe("Ingreso desde, YYYY-MM-DD."),
    to: IsoDateSchema.nullish().describe("Ingreso hasta, YYYY-MM-DD."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(PALLETS_MAX)
      .nullish()
      .describe(
        `Máximo de filas (default ${PALLETS_DEFAULT}, máx ${PALLETS_MAX}).`,
      ),
  }),
  run: async (_ctx, input) => {
    const res = await listPalletsAction();
    if (!res.ok) return errResult(res.error);
    const client = input.client ? fold(input.client) : null;
    const code = input.code ? fold(input.code) : null;
    const matches = res.data.filter(
      (p) =>
        (!client || fold(p.client?.legal_name ?? "").includes(client)) &&
        (!code ||
          fold(p.code).includes(code) ||
          fold(p.lot_number ?? "").includes(code)) &&
        (!input.status || p.status === input.status) &&
        (!input.from || p.entry_date >= input.from) &&
        (!input.to || p.entry_date <= input.to),
    );
    const cap = input.limit ?? PALLETS_DEFAULT;
    const rows = matches.slice(0, cap);
    const inStock = matches.filter((p) => p.status === "en_deposito").length;
    return okResult(
      `${matches.length} pallets (${inStock} en depósito, ${matches.length - inStock} despachados)` +
        (matches.length > cap
          ? `; se muestran los ${cap} más nuevos, acotá el filtro.`
          : "."),
      rows,
      { partial: matches.length > cap },
    );
  },
});

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
      { partial: reachedCap(res.data.length) },
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
    return okResult(`${res.data.length} productos.`, res.data);
  },
});
