import type { InvoiceKind, InvoiceLetter } from "@/lib/afip/codes";
import {
  isListGroup,
  parsePeriodParams,
  resolvePeriod,
  type ListGroup,
  type PeriodSelection,
} from "@/lib/list-period";
import { UuidSchema } from "@/lib/validation/common";

import type { ListComprobantesFilters } from "../actions/invoices-actions";
import {
  isInvoiceKind,
  isInvoiceLetter,
  isInvoiceStatus,
  type InvoiceStatus,
} from "../schema";

/** What the comprobantes list filters on: its query key and action input. */
export interface InvoiceListFilters {
  isFiscal: boolean | null;
  status: InvoiceStatus | null;
  query: string;
  kind: InvoiceKind | null;
  letter: InvoiceLetter | null;
  puntoVenta: number | null;
  clientId: string | null;
  from: string | null;
  to: string | null;
}

/** The list's URL state:
 *  `?status&q&kind&letter&pv&client&period&from&to&group`. */
export interface InvoiceListParams {
  status: InvoiceStatus | null;
  query: string;
  kind: InvoiceKind | null;
  letter: InvoiceLetter | null;
  puntoVenta: number | null;
  clientId: string | null;
  period: PeriodSelection;
  group: ListGroup | null;
}

export function parsePuntoVenta(
  value: string | null | undefined,
): number | null {
  if (!value || !/^\d{1,5}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 ? n : null;
}

export function parseInvoiceListParams(
  params: Record<string, string | undefined>,
): InvoiceListParams {
  const client = UuidSchema.safeParse(params.client);
  return {
    status: isInvoiceStatus(params.status) ? params.status : null,
    query: params.q ?? "",
    kind: isInvoiceKind(params.kind) ? params.kind : null,
    letter: isInvoiceLetter(params.letter) ? params.letter : null,
    puntoVenta: parsePuntoVenta(params.pv),
    clientId: client.success ? client.data : null,
    period: parsePeriodParams(params),
    group: isListGroup(params.group) ? params.group : null,
  };
}

export function invoiceListParamsToUrl(
  params: InvoiceListParams,
): Record<string, string | null> {
  return {
    status: params.status,
    q: params.query.trim() || null,
    kind: params.kind,
    letter: params.letter,
    pv: params.puntoVenta === null ? null : String(params.puntoVenta),
    client: params.clientId,
    period: params.period.preset,
    from: params.period.from,
    to: params.period.to,
    group: params.group,
  };
}

export function invoiceListFilters(
  params: InvoiceListParams,
  isFiscal: boolean | null,
  today?: string,
): InvoiceListFilters {
  const range = resolvePeriod(params.period, today);
  return {
    isFiscal,
    status: params.status,
    query: params.query.trim(),
    kind: params.kind,
    letter: params.letter,
    puntoVenta: params.puntoVenta,
    clientId: params.clientId,
    from: range?.from ?? null,
    to: range?.to ?? null,
  };
}

/** The search box: digits match the number exactly, anything else the
 *  client's legal name. The list and its totals read it the same way. */
export function parseSearchTerm(term: string | null | undefined): {
  numero: number | null;
  clientName: string | null;
} {
  const trimmed = term?.trim() ?? "";
  if (trimmed.length === 0) return { numero: null, clientName: null };
  if (/^\d+$/.test(trimmed))
    return { numero: Number(trimmed), clientName: null };
  return { numero: null, clientName: trimmed };
}

/** The list action's input for one page of `filters`. */
export function invoiceListActionInput(
  filters: InvoiceListFilters,
  offset: number,
  limit: number,
): ListComprobantesFilters {
  return {
    isFiscal: filters.isFiscal,
    status: filters.status,
    kind: filters.kind,
    letter: filters.letter,
    punto_venta: filters.puntoVenta,
    client_id: filters.clientId,
    fecha_desde: filters.from,
    fecha_hasta: filters.to,
    query: filters.query.length > 0 ? filters.query : null,
    offset,
    limit,
  };
}
