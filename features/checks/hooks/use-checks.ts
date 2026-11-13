"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { agingKeys } from "@/features/aging/lib/aging-keys";
import { reconciliationKeys } from "@/features/bank-reconciliation/lib/reconciliation-keys";
import { clientsKeys } from "@/features/clients/lib/clients-keys";
import { invoicesKeys } from "@/features/invoices/lib/invoices-keys";
import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { receiptsKeys } from "@/features/receipts/lib/receipts-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { runAction } from "@/lib/query/run-action";

import {
  createCheckAction,
  creditCheckAction,
  depositCheckAction,
  issueRejectedCheckNdAction,
  listChecksAction,
  rejectCheckAction,
  sellChecksAction,
} from "../actions/checks-actions";
import { checksKeys } from "../lib/checks-keys";

export function useChecksList() {
  const isFiscal = useScopeIsFiscal();
  return useSuspenseQuery({
    queryKey: checksKeys.list(isFiscal),
    queryFn: () => runAction(() => listChecksAction({ isFiscal })),
  });
}

// Mutations -----------------------------------------------------------------

function makeChequeMutation<TInput, TData>(
  fn: (
    input: TInput,
  ) => Promise<{ ok: true; data: TData } | { ok: false; error: string }>,
) {
  return function useChequeMutation() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (input: TInput) => runAction(() => fn(input)),
      // Every check mutation may move cash (cartera, deposit, credit,
      // rejection) and post a fiscal entry; a rejection also puts client
      // debt back (account statement, aging, receipts' pending list). The
      // statement's proposals read the cartera and the sale transfers.
      onSuccess: () => {
        invalidateKeys(qc, [
          checksKeys.all,
          reconciliationKeys.all,
          ...CASH_KEYS,
          ...LEDGER_KEYS,
          clientsKeys.all,
          agingKeys.all,
          receiptsKeys.all,
        ]);
      },
    });
  };
}

export const useCreateCheque = makeChequeMutation(createCheckAction);
export const useDepositCheque = makeChequeMutation(depositCheckAction);
export const useCreditCheque = makeChequeMutation(creditCheckAction);
export const useRejectCheque = makeChequeMutation(rejectCheckAction);
export const useSellCheques = makeChequeMutation(sellChecksAction);

/** «Gastos a cobrarle al cliente»: the ND joins the client's statement, the
 *  comprobantes list and the aging. */
export function useIssueRejectedCheckNd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof issueRejectedCheckNdAction>[0]) =>
      runAction(() => issueRejectedCheckNdAction(input)),
    onSuccess: () => {
      invalidateKeys(qc, [
        invoicesKeys.all,
        clientsKeys.all,
        agingKeys.all,
        receiptsKeys.all,
        ...LEDGER_KEYS,
      ]);
    },
  });
}
