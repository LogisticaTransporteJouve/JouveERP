import { z } from "zod";

import { searchClientsAction } from "@/features/clients/actions/clients-actions";
import { getClientSalesSummaryAction } from "@/features/clients/actions/sales-report-actions";
import { ClientSalesSummaryInputSchema } from "@/features/clients/reports-schema";
import { listInvoicesAction } from "@/features/invoices/actions/invoices-actions";
import { listReceiptsAction } from "@/features/receipts/actions/receipts-actions";

import { defineAiAction } from "../define";
import { type AiRunResult, errResult, money, okResult } from "../result";

// Tool inputs stay loose; the underlying actions re-validate and gate
// (`invoices:read` / `receipts:read` / `clients:read`) + RLS, so the tool
// adds no new data access.

export async function runInvoices(input: {
  query?: string | null;
  channelId?: string | null;
  fechaDesde?: string | null;
  fechaHasta?: string | null;
  limit?: number | null;
}): Promise<AiRunResult> {
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
    `${res.data.items.length} invoices${
      res.data.nextOffset !== null ? " (more available, narrow the filter)" : ""
    } · total ${money(total)}.`,
    res.data,
    { partial: res.data.nextOffset !== null },
  );
}

export const getInvoices = defineAiAction({
  name: "getInvoices",
  domain: "ventas",
  permission: "invoices:read",
  sideEffect: "read",
  sources: ["invoices"],
  description:
    "Issued sales documents (invoices, credit notes, debit notes): list " +
    "filterable by client/number (query), channel, and date range (YYYY-MM-DD). " +
    "Returns number, client, date, total and status. For sales, billing or " +
    "finding a specific document.",
  input: z.object({
    query: z
      .string()
      .nullish()
      .describe("Text to search: exact number or client name."),
    channelId: z.string().nullish().describe("Channel UUID, optional."),
    fechaDesde: z.string().nullish().describe("Date from YYYY-MM-DD."),
    fechaHasta: z.string().nullish().describe("Date to YYYY-MM-DD."),
    limit: z.number().nullish().describe("Max rows (default 25, max 200)."),
  }),
  run: (_ctx, input) => runInvoices(input),
});

export async function runReceipts(input: {
  query?: string | null;
  channelId?: string | null;
  limit?: number | null;
}): Promise<AiRunResult> {
  const res = await listReceiptsAction({
    query: input.query ?? null,
    channelId: input.channelId ?? null,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  const total = res.data.items.reduce((s, r) => s + r.total_amount, 0);
  return okResult(
    `${res.data.items.length} receipts${
      res.data.nextOffset !== null ? " (more available)" : ""
    } · total collected ${money(total)}.`,
    res.data,
    { partial: res.data.nextOffset !== null },
  );
}

export const getReceipts = defineAiAction({
  name: "getReceipts",
  domain: "ventas",
  permission: "receipts:read",
  sideEffect: "read",
  sources: ["receipts"],
  description:
    "Collection receipts: list filterable by number/client (query) and channel. " +
    "Returns number, client, date, amount and currency. For collections or " +
    "finding a specific receipt.",
  input: z.object({
    query: z.string().nullish().describe("Exact receipt number to search."),
    channelId: z.string().nullish().describe("Channel UUID, optional."),
    limit: z.number().nullish().describe("Max rows (default 25, max 200)."),
  }),
  run: (_ctx, input) => runReceipts(input),
});

export async function runSearchClients(input: {
  query?: string | null;
  onlyActive?: boolean | null;
  limit?: number | null;
}): Promise<AiRunResult> {
  const res = await searchClientsAction({
    query: input.query ?? "",
    onlyActive: input.onlyActive ?? true,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.clients.length} clients${
      res.data.nextOffset !== null ? " (more available, refine the search)" : ""
    }.`,
    res.data,
    { partial: res.data.nextOffset !== null },
  );
}

export const searchClients = defineAiAction({
  name: "searchClients",
  domain: "ventas",
  permission: "clients:read",
  sideEffect: "read",
  sources: ["search_clients"],
  description:
    "Search clients by name or CUIT (full-text). Returns each client's data " +
    "(legal name, CUIT, VAT condition, contact). Useful to find the client_id " +
    "other tools require or to resolve who the user is referring to.",
  input: z.object({
    query: z.string().nullish().describe("Text to search: name or CUIT."),
    onlyActive: z.boolean().nullish().describe("Active only (default true)."),
    limit: z.number().nullish().describe("Max rows (default 25, max 200)."),
  }),
  run: (_ctx, input) => runSearchClients(input),
});

export const getClientSalesSummary = defineAiAction({
  name: "getClientSalesSummary",
  domain: "ventas",
  permission: ["clients:read", "invoices:read", "receipts:read"],
  sideEffect: "read",
  sources: [
    "ai_client_sales_summary",
    "invoices",
    "receipts",
    "receipt_allocations",
    "v_aging_documents",
  ],
  description:
    "Ranking de clientes en un rango de fechas: facturado en ARS (facturas y ND menos NC, a la cotización de cada comprobante), cobrado por moneda, días promedio de cobro, deuda abierta y vencida actual, con totales de todos los clientes. Opcional un cliente.",
  input: ClientSalesSummaryInputSchema,
  run: async (_ctx, input) => {
    const res = await getClientSalesSummaryAction(input);
    if (!res.ok) return errResult(res.error);
    const first = res.data[0];
    const clients = first?.total_clients ?? 0;
    return okResult(
      `Clientes ${input.from}→${input.to}: ${clients} con movimiento · facturado ${money(
        first?.total_invoiced_ars ?? 0,
      )} · cobrado ARS ${money(first?.total_collected_ars ?? 0)} · deuda abierta ARS ${money(
        first?.total_open_ars ?? 0,
      )}` +
        (clients > res.data.length
          ? ` (se muestran ${res.data.length}).`
          : "."),
      { rows: res.data },
      {
        currency: "ARS",
        partial: clients > res.data.length,
        note: "Cobrado en USD y deuda en moneda extranjera van aparte (collected_usd, open_foreign), sin convertir.",
      },
    );
  },
});
