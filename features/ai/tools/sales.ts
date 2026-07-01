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
    `${res.data.items.length} invoices${
      res.data.nextOffset !== null ? " (more available, narrow the filter)" : ""
    } · total ${money(total)}.`,
    res.data,
  );
}

export const getInvoices = tool({
  description:
    "Issued sales documents (invoices, credit notes, debit notes): list " +
    "filterable by client/number (query), channel, and date range (YYYY-MM-DD). " +
    "Returns number, client, date, total and status. For sales, billing or " +
    "finding a specific document.",
  inputSchema: z.object({
    query: z
      .string()
      .nullish()
      .describe("Text to search: exact number or client name."),
    channelId: z.string().nullish().describe("Channel UUID, optional."),
    fechaDesde: z.string().nullish().describe("Date from YYYY-MM-DD."),
    fechaHasta: z.string().nullish().describe("Date to YYYY-MM-DD."),
    limit: z.number().nullish().describe("Max rows (default 25, max 200)."),
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
    `${res.data.items.length} receipts${
      res.data.nextOffset !== null ? " (more available)" : ""
    } · total collected ${money(total)}.`,
    res.data,
  );
}

export const getReceipts = tool({
  description:
    "Collection receipts: list filterable by number/client (query) and channel. " +
    "Returns number, client, date, amount and currency. For collections or " +
    "finding a specific receipt.",
  inputSchema: z.object({
    query: z
      .string()
      .nullish()
      .describe("Exact receipt number to search."),
    channelId: z.string().nullish().describe("Channel UUID, optional."),
    limit: z.number().nullish().describe("Max rows (default 25, max 200)."),
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
    `${res.data.clients.length} clients${
      res.data.nextOffset !== null ? " (more available, refine the search)" : ""
    }.`,
    res.data,
  );
}

export const searchClients = tool({
  description:
    "Search clients by name or CUIT (full-text). Returns each client's data " +
    "(legal name, CUIT, VAT condition, contact). Useful to find the client_id " +
    "other tools require or to resolve who the user is referring to.",
  inputSchema: z.object({
    query: z.string().nullish().describe("Text to search: name or CUIT."),
    onlyActive: z
      .boolean()
      .nullish()
      .describe("Active only (default true)."),
    limit: z.number().nullish().describe("Max rows (default 25, max 200)."),
  }),
  execute: (input) => runSearchClients(input),
});
