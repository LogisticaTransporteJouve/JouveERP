"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { agingKeys } from "@/features/aging/lib/aging-keys";
import { clientsKeys } from "@/features/clients/lib/clients-keys";
import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  cancelCheckSaleAction,
  getSoldChecksExposureAction,
  listCheckSaleDebtsAction,
  listCheckSalesAction,
  payCheckSaleDebtAction,
  rejectSoldCheckAsDebtAction,
} from "../actions/check-sale-followups-actions";
import type {
  CancelCheckSaleInput,
  PayCheckSaleDebtInput,
  RejectSoldCheckAsDebtInput,
} from "../lib/check-sales";
import { checksKeys } from "../lib/checks-keys";

export function useCheckSales() {
  const isFiscal = useScopeIsFiscal();
  return useQuery({
    queryKey: checksKeys.sales(isFiscal),
    queryFn: () => runAction(() => listCheckSalesAction({ isFiscal })),
  });
}

export function useCheckSaleDebts() {
  return useQuery({
    queryKey: checksKeys.saleDebts(),
    queryFn: () => runAction(() => listCheckSaleDebtsAction()),
  });
}

export function useSoldChecksExposure() {
  const isFiscal = useScopeIsFiscal();
  return useQuery({
    queryKey: checksKeys.soldExposure(isFiscal),
    queryFn: () => runAction(() => getSoldChecksExposureAction({ isFiscal })),
  });
}

// A cancelled sale moves cash back and deletes fiscal entries; a rejection
// puts client debt back; a payment moves cash and posts an entry.
const CHECK_SALE_KEYS = [
  checksKeys.all,
  ...CASH_KEYS,
  ...LEDGER_KEYS,
  clientsKeys.all,
  agingKeys.all,
] as const;

export function useCancelCheckSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CancelCheckSaleInput) =>
      runAction(() => cancelCheckSaleAction(input)),
    onSuccess: () => invalidateKeys(qc, CHECK_SALE_KEYS),
  });
}

export function useRejectSoldCheckAsDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RejectSoldCheckAsDebtInput) =>
      runAction(() => rejectSoldCheckAsDebtAction(input)),
    onSuccess: () => invalidateKeys(qc, CHECK_SALE_KEYS),
  });
}

export function usePayCheckSaleDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PayCheckSaleDebtInput) =>
      runAction(() => payCheckSaleDebtAction(input)),
    onSuccess: () => invalidateKeys(qc, CHECK_SALE_KEYS),
  });
}
