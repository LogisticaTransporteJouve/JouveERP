"use client";

import { useQuery } from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { getLedgerAction } from "../actions/libro-mayor-actions";
import { libroMayorKeys } from "../lib/libro-mayor-keys";

export function useLedger(
  accountId: string | null,
  from: string | null,
  to: string | null,
) {
  return useQuery({
    queryKey: libroMayorKeys.ledger(accountId, from, to),
    queryFn: () =>
      runAction(() =>
        getLedgerAction({
          accountId: accountId!,
          from: from ?? undefined,
          to: to ?? undefined,
        }),
      ),
    enabled: !!accountId,
  });
}
