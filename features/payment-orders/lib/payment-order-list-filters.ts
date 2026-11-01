import {
  parsePeriodParams,
  resolvePeriod,
  type PeriodSelection,
} from "@/lib/list-period";

import { isPaymentOrderStatus, type PaymentOrderStatus } from "../schema";

/** What the payment orders list filters on: its query key and action input. */
export interface PaymentOrderListFilters {
  isFiscal: boolean | null;
  status: PaymentOrderStatus | null;
  /** OP number (digits) or supplier name (`parseSearchTerm`). */
  query: string;
  from: string | null;
  to: string | null;
}

/** The list's URL state: `?q&status&period&from&to`. */
export interface PaymentOrderListParams {
  query: string;
  status: PaymentOrderStatus | null;
  period: PeriodSelection;
}

/** The list with no filter (the "Limpiar" target). */
export const DEFAULT_PAYMENT_ORDER_LIST_PARAMS: PaymentOrderListParams = {
  query: "",
  status: null,
  period: { preset: null, from: null, to: null },
};

export function parsePaymentOrderListParams(
  params: Record<string, string | undefined>,
): PaymentOrderListParams {
  return {
    query: params.q ?? "",
    status: isPaymentOrderStatus(params.status) ? params.status : null,
    period: parsePeriodParams(params),
  };
}

export function paymentOrderListParamsToUrl(
  params: PaymentOrderListParams,
): Record<string, string | null> {
  return {
    q: params.query.trim() || null,
    status: params.status,
    period: params.period.preset,
    from: params.period.from,
    to: params.period.to,
  };
}

export function paymentOrderListFilters(
  params: PaymentOrderListParams,
  isFiscal: boolean | null,
  today?: string,
): PaymentOrderListFilters {
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
export function paymentOrderListActionInput(
  filters: PaymentOrderListFilters,
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
