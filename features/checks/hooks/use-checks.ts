"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { agingKeys } from "@/features/aging/lib/aging-keys";
import { clientsKeys } from "@/features/clients/lib/clients-keys";
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
  listChecksAction,
  rejectCheckAction,
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
      // debt back (account statement, aging, receipts' pending list).
      onSuccess: () => {
        invalidateKeys(qc, [
          checksKeys.all,
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
