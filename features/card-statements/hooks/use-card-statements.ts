"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createCardStatementAction,
  deleteCardStatementAction,
  getCardStatementAction,
  listCardStatementsAction,
  setCardHolderAction,
  setCardLinesAction,
} from "../actions/card-statements-actions";
import { cardStatementsKeys } from "../lib/card-statements-keys";
import type {
  CreateCardStatementInput,
  SetCardHolderInput,
  SetCardLinesInput,
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

function useCardMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: cardStatementsKeys.all }),
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
export function useDeleteCardStatement() {
  return useCardMutation((id: string) =>
    runAction(() => deleteCardStatementAction({ id })),
  );
}
