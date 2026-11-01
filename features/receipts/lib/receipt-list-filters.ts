import {
  DEFAULT_LIST_GROUP,
  listGroupParam,
  parseListGroupParam,
  parsePeriodParams,
  resolvePeriod,
  type ListGroup,
  type PeriodSelection,
} from "@/lib/list-period";

import { isReceiptStatus, type ReceiptStatus } from "../schema";

/** What the receipts list filters on: its query key and action input. */
export interface ReceiptListFilters {
  isFiscal: boolean | null;
  status: ReceiptStatus | null;
  /** Receipt number (digits) or client name (`parseSearchTerm`). */
  query: string;
  from: string | null;
  to: string | null;
}

/** The list's URL state: `?status&q&period&from&to&group`. */
export interface ReceiptListParams {
  status: ReceiptStatus | null;
  query: string;
  period: PeriodSelection;
  group: ListGroup | null;
}

/** The list with no filter (the "Limpiar" target), grouped by day. */
export const DEFAULT_RECEIPT_LIST_PARAMS: ReceiptListParams = {
  status: null,
  query: "",
  period: { preset: null, from: null, to: null },
  group: DEFAULT_LIST_GROUP,
};

export function parseReceiptListParams(
  params: Record<string, string | undefined>,
): ReceiptListParams {
  return {
    status: isReceiptStatus(params.status) ? params.status : null,
    query: params.q ?? "",
    period: parsePeriodParams(params),
    group: parseListGroupParam(params.group),
  };
}

export function receiptListParamsToUrl(
  params: ReceiptListParams,
): Record<string, string | null> {
  return {
    status: params.status,
    q: params.query.trim() || null,
    period: params.period.preset,
    from: params.period.from,
    to: params.period.to,
    group: listGroupParam(params.group),
  };
}

export function receiptListFilters(
  params: ReceiptListParams,
  isFiscal: boolean | null,
  today?: string,
): ReceiptListFilters {
  const range = resolvePeriod(params.period, today);
  return {
    isFiscal,
    status: params.status,
    query: params.query.trim(),
    from: range?.from ?? null,
    to: range?.to ?? null,
  };
}

/** The list action's input for one page of `filters`. */
export function receiptListActionInput(
  filters: ReceiptListFilters,
  offset: number,
  limit: number,
) {
  return {
    isFiscal: filters.isFiscal,
    status: filters.status,
    query: filters.query.length > 0 ? filters.query : null,
    from: filters.from,
    to: filters.to,
    offset,
    limit,
  };
}
