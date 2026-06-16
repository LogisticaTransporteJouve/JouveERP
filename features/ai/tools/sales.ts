import { tool } from "ai";
import { z } from "zod";

import { searchClientsAction } from "@/features/clients/actions/clients-actions";
import { listInvoicesAction } from "@/features/invoices/actions/invoices-actions";
import { listReceiptsAction } from "@/features/receipts/actions/receipts-actions";

import { type AiToolResult, errResult, money, okResult } from "./result";

// Tool inputs stay loose; the underlying actions re-validate and gate
// (`invoices:read` / `receipts:read` / `clients:read`) + RLS, so the tool
// adds no new data access.

export async function runInvoices(input: {
  query?: string | null;
  channelId?: string | null;
  fechaDesde?: string | null;
  fechaHasta?: string | null;
  limit?: number | null;
}): Promise<AiToolResult> {
  const res = await listInvoicesAction({
    query: input.query ?? null,
    channel_id: input.channelId ?? null,
    fecha_desde: input.fechaDesde ?? null,
    fecha_hasta: input.fechaHasta ?? null,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  const total = res.data.items.reduce((s, i) => s + i.imp_total, 0);
  return okResult(
    `${res.data.items.length} comprobantes${
      res.data.nextOffset !== null ? " (hay más, acotá el filtro)" : ""
    } · total ${money(total)}.`,
    res.data,
  );
}

export const getInvoices = tool({
  description:
    "Comprobantes de venta emitidos (facturas, NC, ND): listado filtrable por " +
    "cliente/número (query), canal, y rango de fechas (YYYY-MM-DD). Devuelve " +
    "número, cliente, fecha, total y estado. Para ventas, facturación o buscar " +
    "un comprobante puntual.",
  inputSchema: z.object({
    query: z
      .string()
      .nullish()
      .describe("Texto a buscar: número exacto o nombre del cliente."),
    channelId: z.string().nullish().describe("UUID del canal, opcional."),
    fechaDesde: z.string().nullish().describe("Fecha desde YYYY-MM-DD."),
    fechaHasta: z.string().nullish().describe("Fecha hasta YYYY-MM-DD."),
    limit: z.number().nullish().describe("Máximo de filas (default 25, máx 200)."),
  }),
  execute: (input) => runInvoices(input),
});

export async function runReceipts(input: {
  query?: string | null;
  channelId?: string | null;
  limit?: number | null;
}): Promise<AiToolResult> {
  const res = await listReceiptsAction({
    query: input.query ?? null,
    channelId: input.channelId ?? null,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  const total = res.data.items.reduce((s, r) => s + r.total_amount, 0);
  return okResult(
    `${res.data.items.length} recibos${
      res.data.nextOffset !== null ? " (hay más)" : ""
    } · total cobrado ${money(total)}.`,
    res.data,
  );
}

export const getReceipts = tool({
  description:
    "Recibos de cobranza: listado filtrable por número/cliente (query) y canal. " +
    "Devuelve número, cliente, fecha, importe y moneda. Para cobranzas o buscar " +
    "un recibo puntual.",
  inputSchema: z.object({
    query: z
      .string()
      .nullish()
      .describe("Número exacto del recibo a buscar."),
    channelId: z.string().nullish().describe("UUID del canal, opcional."),
    limit: z.number().nullish().describe("Máximo de filas (default 25, máx 200)."),
  }),
  execute: (input) => runReceipts(input),
});

export async function runSearchClients(input: {
  query?: string | null;
  onlyActive?: boolean | null;
  limit?: number | null;
}): Promise<AiToolResult> {
  const res = await searchClientsAction({
    query: input.query ?? "",
    onlyActive: input.onlyActive ?? true,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.clients.length} clientes${
      res.data.nextOffset !== null ? " (hay más, afiná la búsqueda)" : ""
    }.`,
    res.data,
  );
}

export const searchClients = tool({
  description:
    "Busca clientes por nombre o CUIT (full-text). Devuelve datos de cada cliente " +
    "(razón social, CUIT, condición IVA, contacto). Útil para encontrar el " +
    "client_id que piden otras tools o resolver a quién se refiere el usuario.",
  inputSchema: z.object({
    query: z.string().nullish().describe("Texto a buscar: nombre o CUIT."),
    onlyActive: z
      .boolean()
      .nullish()
      .describe("Solo activos (default true)."),
    limit: z.number().nullish().describe("Máximo de filas (default 25, máx 200)."),
  }),
  execute: (input) => runSearchClients(input),
});
