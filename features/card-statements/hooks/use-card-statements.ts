"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { reconciliationKeys } from "@/features/bank-reconciliation/lib/reconciliation-keys";
import { accountKeys } from "@/features/hr/lib/account-keys";
import { employeesKeys } from "@/features/hr/lib/employees-keys";
import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  createCardStatementAction,
  deleteCardStatementAction,
  getCardStatementAction,
  listCardStatementsAction,
  setCardHolderAction,
  setCardLinesAction,
  unsettleCardStatementAction,
} from "../actions/card-statements-actions";
import { cardStatementsKeys } from "../lib/card-statements-keys";
import type {
  CreateCardStatementInput,
  SetCardHolderInput,
  SetCardLinesInput,
  UnsettleCardStatementInput,
} from "../schema";

export function useCardStatements() {
  return useSuspenseQuery({
    queryKey: cardStatementsKeys.list(),
    queryFn: () => runAction(() => listCardStatementsAction()),
  });
}

export function useCardStatement(id: string | null) {
  return useQuery({
    queryKey: cardStatementsKeys.detail(id ?? ""),
    queryFn: () => runAction(() => getCardStatementAction(id ?? "")),
    enabled: id !== null,
  });
}

// On settled: an action may write part and then fail (the card default saved
// but not applied). The reconciliation coding reads the statements too (its
// «Pagar resumen» proposal).
function useCardMutation<I, O>(
  fn: (input: I) => Promise<O>,
  alsoKeys: readonly (readonly unknown[])[] = [],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      invalidateKeys(qc, [
        cardStatementsKeys.all,
        reconciliationKeys.all,
        ...alsoKeys,
      ]),
  });
}

export function useCreateCardStatement() {
  return useCardMutation((input: CreateCardStatementInput) =>
    runAction(() => createCardStatementAction(input)),
  );
}
export function useSetCardLines() {
  return useCardMutation((input: SetCardLinesInput) =>
    runAction(() => setCardLinesAction(input)),
  );
}
export function useSetCardHolder() {
  return useCardMutation((input: SetCardHolderInput) =>
    runAction(() => setCardHolderAction(input)),
  );
}
export function useUnsettleCardStatement() {
  return useCardMutation(
    (input: UnsettleCardStatementInput) =>
      runAction(() => unsettleCardStatementAction(input)),
    [...CASH_KEYS, ...LEDGER_KEYS, employeesKeys.all, accountKeys.all],
  );
}

export function useDeleteCardStatement() {
  return useCardMutation((id: string) =>
    runAction(() => deleteCardStatementAction({ id })),
  );
}
