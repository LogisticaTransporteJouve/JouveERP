"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  deleteBankStatementCodeAction,
  getStatementCodingAction,
  presetBankStatementCodesAction,
  saveBankStatementCodeAction,
} from "../actions/statement-codes-actions";
import { reconciliationKeys } from "../lib/reconciliation-keys";
import type { BankCodePreset, SaveBankStatementCodeInput } from "../schema";

/** The codes and clients that classify the period's lines. Not suspense: the
 *  statement shows while it loads, the proposals fill in after. */
export function useStatementCoding(
  accountId: string,
  from: string,
  to: string,
) {
  return useQuery({
    queryKey: reconciliationKeys.coding(accountId, from, to),
    queryFn: () =>
      runAction(() =>
        getStatementCodingAction({ account_id: accountId, from, to }),
      ),
  });
}

function useCodesMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => invalidateKeys(qc, [reconciliationKeys.all]),
  });
}

export function useSaveBankStatementCode() {
  return useCodesMutation((input: SaveBankStatementCodeInput) =>
    runAction(() => saveBankStatementCodeAction(input)),
  );
}

export function useDeleteBankStatementCode() {
  return useCodesMutation((id: string) =>
    runAction(() => deleteBankStatementCodeAction({ id })),
  );
}

export function usePresetBankStatementCodes() {
  return useCodesMutation(
    (input: { account_id: string; preset: BankCodePreset }) =>
      runAction(() => presetBankStatementCodesAction(input)),
  );
}
