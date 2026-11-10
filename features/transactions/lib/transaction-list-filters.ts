import {
  ALL_DATES_PARAM,
  parsePeriodParams,
  resolvePeriod,
  type PeriodSelection,
} from "@/lib/list-period";
import { UuidSchema } from "@/lib/validation/common";

import {
  isReconciledFilter,
  isTransactionKind,
  type ReconciledFilter,
  type TransactionFilters,
  type TransactionKind,
} from "../schema";

/** Caja's URL state: `?id&account&kind&reconciled&period&from&to`. */
export interface TransactionListParams {
  /** One movement, from a link (the journal's origin); no control sets it. */
  id: string | null;
  accountId: string | null;
  kind: TransactionKind | null;
  reconciled: ReconciledFilter | null;
  period: PeriodSelection;
}

/** The list with no filter (the "Limpiar" target). */
export const DEFAULT_TRANSACTION_LIST_PARAMS: TransactionListParams = {
  id: null,
  accountId: null,
  kind: null,
  reconciled: null,
  period: { preset: null, from: null, to: null },
};

export function parseTransactionListParams(
  params: Record<string, string | undefined>,
): TransactionListParams {
  const id = UuidSchema.safeParse(params.id);
  const account = UuidSchema.safeParse(params.account);
  return {
    id: id.success ? id.data : null,
    accountId: account.success ? account.data : null,
    kind: isTransactionKind(params.kind) ? params.kind : null,
    reconciled: isReconciledFilter(params.reconciled)
      ? params.reconciled
      : null,
    period: parsePeriodParams(params),
  };
}

export function transactionListParamsToUrl(
  params: TransactionListParams,
): Record<string, string | null> {
  return {
    id: params.id,
    account: params.accountId,
    kind: params.kind,
    reconciled: params.reconciled,
    period: params.period.preset,
    from: params.period.from,
    to: params.period.to,
  };
}

/** The movements of one account: the period is shared with its statement
 *  tab through the URL, so «Todas las fechas» is written too (`period=all`)
 *  instead of left out, which there means the current month. */
export function accountTransactionListParamsToUrl(
  params: TransactionListParams,
): Record<string, string | null> {
  const url = transactionListParamsToUrl(params);
  return { ...url, period: url.period ?? ALL_DATES_PARAM };
}

/** The list's query key and action input (paging added by the hook). */
export function transactionListFilters(
  params: TransactionListParams,
  isFiscal: boolean | null,
  today?: string,
): TransactionFilters {
  const range = resolvePeriod(params.period, today);
  return {
    id: params.id,
    is_fiscal: isFiscal,
    account_id: params.accountId,
    kind: params.kind,
    reconciled: params.reconciled,
    date_from: range?.from ?? null,
    date_to: range?.to ?? null,
  };
}
