import {
  parsePeriodParams,
  resolvePeriod,
  type PeriodSelection,
} from "@/lib/list-period";
import type { ChannelScope } from "@/lib/scope";

import { isPurchaseInvoiceStatus, type PurchaseInvoiceStatus } from "../schema";
import type { PurchaseInvoicesFilters } from "./purchase-invoices-keys";

/** The purchases list's URL state: `?q&status&period&from&to`. */
export interface PurchaseListParams {
  query: string;
  status: PurchaseInvoiceStatus | null;
  period: PeriodSelection;
}

/** The list with no filter (the "Limpiar" target). */
export const DEFAULT_PURCHASE_LIST_PARAMS: PurchaseListParams = {
  query: "",
  status: null,
  period: { preset: null, from: null, to: null },
};

export function parsePurchaseListParams(
  params: Record<string, string | undefined>,
): PurchaseListParams {
  return {
    query: params.q ?? "",
    status: isPurchaseInvoiceStatus(params.status) ? params.status : null,
    period: parsePeriodParams(params),
  };
}

export function purchaseListParamsToUrl(
  params: PurchaseListParams,
): Record<string, string | null> {
  return {
    q: params.query.trim() || null,
    status: params.status,
    period: params.period.preset,
    from: params.period.from,
    to: params.period.to,
  };
}

/** `scope.channelId`: a segregated channel's section; null lists the main
 *  app (the search RPC leaves segregated channels out). */
export function purchaseListFilters(
  params: PurchaseListParams,
  scope: ChannelScope,
  today?: string,
): PurchaseInvoicesFilters {
  const range = resolvePeriod(params.period, today);
  return {
    query: params.query.trim(),
    supplierId: null,
    channelId: scope.channelId,
    status: params.status,
    fechaFrom: range?.from ?? null,
    fechaTo: range?.to ?? null,
    isFiscal: scope.isFiscal,
  };
}
