import {
  parsePeriodParams,
  resolvePeriod,
  type PeriodSelection,
} from "@/lib/list-period";
import { UuidSchema } from "@/lib/validation/common";

import {
  isTransactionKind,
  type TransactionFilters,
  type TransactionKind,
} from "../schema";

/** Caja's URL state: `?account&kind&period&from&to`. */
export interface TransactionListParams {
  accountId: string | null;
  kind: TransactionKind | null;
  period: PeriodSelection;
}

/** The list with no filter (the "Limpiar" target). */
export const DEFAULT_TRANSACTION_LIST_PARAMS: TransactionListParams = {
  accountId: null,
  kind: null,
  period: { preset: null, from: null, to: null },
};

export function parseTransactionListParams(
  params: Record<string, string | undefined>,
): TransactionListParams {
  const account = UuidSchema.safeParse(params.account);
  return {
    accountId: account.success ? account.data : null,
    kind: isTransactionKind(params.kind) ? params.kind : null,
    period: parsePeriodParams(params),
  };
}

export function transactionListParamsToUrl(
  params: TransactionListParams,
): Record<string, string | null> {
  return {
    account: params.accountId,
    kind: params.kind,
    period: params.period.preset,
    from: params.period.from,
    to: params.period.to,
  };
}

/** The list's query key and action input (paging added by the hook). */
export function transactionListFilters(
  params: TransactionListParams,
  isFiscal: boolean | null,
  today?: string,
): TransactionFilters {
  const range = resolvePeriod(params.period, today);
  return {
    is_fiscal: isFiscal,
    account_id: params.accountId,
    kind: params.kind,
    date_from: range?.from ?? null,
    date_to: range?.to ?? null,
  };
}
