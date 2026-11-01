import {
  DEFAULT_LIST_GROUP,
  listGroupParam,
  parseListGroupParam,
  parsePeriodParams,
  resolvePeriod,
  type ListGroup,
  type PeriodSelection,
} from "@/lib/list-period";

import type { ListComprobantesFilters } from "../actions/invoices-actions";
import { isInvoiceStatus, type InvoiceStatus } from "../schema";

/** The "Tipo" filter: facturas split by letter, NC and ND whole. */
export const INVOICE_LIST_TYPES = [
  "factura_A",
  "factura_B",
  "nc",
  "nd",
] as const;
export type InvoiceListType = (typeof INVOICE_LIST_TYPES)[number];

export const INVOICE_LIST_TYPE_LABEL: Record<InvoiceListType, string> = {
  factura_A: "Factura A",
  factura_B: "Factura B",
  nc: "Nota de Crédito",
  nd: "Nota de Débito",
};

export const INVOICE_LIST_TYPE_SHORT: Record<InvoiceListType, string> = {
  factura_A: "Factura A",
  factura_B: "Factura B",
  nc: "NC",
  nd: "ND",
};

/** Distinct known types in canonical order, so equal selections share a
 *  query key and a URL. */
export function normalizeInvoiceListTypes(
  values: readonly string[],
): InvoiceListType[] {
  return INVOICE_LIST_TYPES.filter((t) => values.includes(t));
}

/** PostgREST `or` filter matching any of `types` (null: no filter). Unknown
 *  values are dropped, never interpolated: the input comes from the client. */
export function invoiceTypesOrFilter(types: readonly string[]): string | null {
  const known = normalizeInvoiceListTypes(types);
  if (known.length === 0) return null;
  return known
    .map((t) =>
      t === "nc" || t === "nd"
        ? `kind.eq.${t}`
        : `and(kind.eq.factura,letter.eq.${t.slice("factura_".length)})`,
    )
    .join(",");
}

/** What the comprobantes list filters on: its query key and action input. */
export interface InvoiceListFilters {
  isFiscal: boolean | null;
  status: InvoiceStatus | null;
  query: string;
  /** Empty: every type. */
  types: InvoiceListType[];
  from: string | null;
  to: string | null;
}

/** The list's URL state:
 *  `?status&q&type&period&from&to&group` (`type` is a
 *  comma-separated list, e.g. `factura_A,nc`). */
export interface InvoiceListParams {
  status: InvoiceStatus | null;
  query: string;
  types: InvoiceListType[];
  period: PeriodSelection;
  group: ListGroup | null;
}

export function parseInvoiceListParams(
  params: Record<string, string | undefined>,
): InvoiceListParams {
  return {
    status: isInvoiceStatus(params.status) ? params.status : null,
    query: params.q ?? "",
    types: normalizeInvoiceListTypes(params.type?.split(",") ?? []),
    period: parsePeriodParams(params),
    group: parseListGroupParam(params.group),
  };
}

export function invoiceListParamsToUrl(
  params: InvoiceListParams,
): Record<string, string | null> {
  return {
    status: params.status,
    q: params.query.trim() || null,
    type: params.types.length > 0 ? params.types.join(",") : null,
    period: params.period.preset,
    from: params.period.from,
    to: params.period.to,
    group: listGroupParam(params.group),
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
    types: params.types,
    from: range?.from ?? null,
    to: range?.to ?? null,
  };
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
    types: filters.types,
    fecha_desde: filters.from,
    fecha_hasta: filters.to,
    query: filters.query.length > 0 ? filters.query : null,
    offset,
    limit,
  };
}

/** The list with no filter (the "Limpiar" target), grouped by day. */
export const DEFAULT_INVOICE_LIST_PARAMS: InvoiceListParams = {
  status: null,
  query: "",
  types: [],
  period: { preset: null, from: null, to: null },
  group: DEFAULT_LIST_GROUP,
};
