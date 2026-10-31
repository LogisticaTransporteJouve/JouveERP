import {
  isListGroup,
  parsePeriodParams,
  resolvePeriod,
  type ListGroup,
  type PeriodSelection,
} from "@/lib/list-period";
import { UuidSchema } from "@/lib/validation/common";

import { isReceiptStatus, type ReceiptStatus } from "../schema";

/** What the receipts list filters on: its query key and action input. */
export interface ReceiptListFilters {
  isFiscal: boolean | null;
  status: ReceiptStatus | null;
  /** Receipt number (digits only; anything else is ignored). */
  query: string;
  clientId: string | null;
  from: string | null;
  to: string | null;
}

/** The list's URL state: `?status&q&client&period&from&to&group`. */
export interface ReceiptListParams {
  status: ReceiptStatus | null;
  query: string;
  clientId: string | null;
  period: PeriodSelection;
  group: ListGroup | null;
}

export function parseReceiptListParams(
  params: Record<string, string | undefined>,
): ReceiptListParams {
  const client = UuidSchema.safeParse(params.client);
  return {
    status: isReceiptStatus(params.status) ? params.status : null,
    query: params.q ?? "",
    clientId: client.success ? client.data : null,
    period: parsePeriodParams(params),
    group: isListGroup(params.group) ? params.group : null,
  };
}

export function receiptListParamsToUrl(
  params: ReceiptListParams,
): Record<string, string | null> {
  return {
    status: params.status,
    q: params.query.trim() || null,
    client: params.clientId,
    period: params.period.preset,
    from: params.period.from,
    to: params.period.to,
    group: params.group,
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
    clientId: params.clientId,
    from: range?.from ?? null,
    to: range?.to ?? null,
  };
}

/** The receipt number the search box holds, or null. */
export function receiptNumeroOf(
  query: string | null | undefined,
): number | null {
  const trimmed = query?.trim() ?? "";
  return /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : null;
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
    clientId: filters.clientId,
    from: filters.from,
    to: filters.to,
    offset,
    limit,
  };
}
