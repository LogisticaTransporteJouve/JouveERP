"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { agingKeys } from "@/features/aging/lib/aging-keys";
import { checksKeys } from "@/features/checks/lib/checks-keys";
import { clientsKeys } from "@/features/clients/lib/clients-keys";
import { invoicesKeys } from "@/features/invoices/lib/invoices-keys";
import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { receiptsKeys } from "@/features/receipts/lib/receipts-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  cancelDriverSettlementAction,
  confirmDriverSettlementAction,
  getDriverSettlementAction,
  listCodPendingAction,
  listDriverSettlementAccountsAction,
  listDriverSettlementsAction,
  saveDriverSettlementAction,
} from "../actions/driver-settlements-actions";
import { driverSettlementsKeys } from "../lib/driver-settlements-keys";
import type { DriverSettlementSaveInput } from "../schema";

export function useDriverSettlements() {
  return useSuspenseQuery({
    queryKey: driverSettlementsKeys.list(),
    queryFn: () => runAction(() => listDriverSettlementsAction()),
  });
}

export function useCodPending() {
  return useSuspenseQuery({
    queryKey: driverSettlementsKeys.pending(),
    queryFn: () => runAction(() => listCodPendingAction()),
  });
}

export function useDriverSettlement(id: string | null) {
  return useQuery({
    queryKey: driverSettlementsKeys.detail(id ?? "none"),
    queryFn: () => runAction(() => getDriverSettlementAction(id ?? "")),
    enabled: id !== null,
  });
}

export function useSettlementAccounts(enabled: boolean) {
  return useQuery({
    queryKey: driverSettlementsKeys.accounts(),
    queryFn: () => runAction(() => listDriverSettlementAccountsAction()),
    enabled,
    staleTime: 60_000,
  });
}

export function useSaveDriverSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DriverSettlementSaveInput) =>
      runAction(() => saveDriverSettlementAction(input)),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: driverSettlementsKeys.all }),
  });
}

// Confirming posts receipts: cash and checks move, invoices get applied and
// a fiscal entry is posted, as a receipt does.
const POSTING_KEYS = [
  driverSettlementsKeys.all,
  receiptsKeys.all,
  ...CASH_KEYS,
  clientsKeys.all,
  agingKeys.all,
  invoicesKeys.all,
  checksKeys.all,
  ...LEDGER_KEYS,
] as const;

export function useConfirmDriverSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => confirmDriverSettlementAction({ id })),
    onSuccess: () => invalidateKeys(qc, POSTING_KEYS),
  });
}

export function useCancelDriverSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => cancelDriverSettlementAction({ id })),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: driverSettlementsKeys.all }),
  });
}
