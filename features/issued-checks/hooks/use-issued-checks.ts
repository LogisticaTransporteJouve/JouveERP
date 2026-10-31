"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { paymentOrdersKeys } from "@/features/payment-orders/lib/payment-orders-keys";
import { suppliersKeys } from "@/features/suppliers/lib/suppliers-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  createIssuedCheckAction,
  listIssuedChecksAction,
  transitionIssuedCheckAction,
  updateIssuedCheckAction,
} from "../actions/issued-checks-actions";
import { issuedChecksKeys } from "../lib/issued-checks-keys";

/** An issued check hangs off a payment order, owes the supplier until it is
 *  cashed, moves the bank account and posts on cashing or rejection. */
const ISSUED_CHECK_EFFECT_KEYS = [
  issuedChecksKeys.all,
  paymentOrdersKeys.all,
  suppliersKeys.all,
  ...CASH_KEYS,
  ...LEDGER_KEYS,
] as const;

export function useIssuedChecksList() {
  const isFiscal = useScopeIsFiscal();
  return useSuspenseQuery({
    queryKey: issuedChecksKeys.list(isFiscal),
    queryFn: () => runAction(() => listIssuedChecksAction({ isFiscal })),
  });
}

export function useCreateIssuedCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createIssuedCheckAction(input)),
    onSuccess: () => {
      invalidateKeys(qc, ISSUED_CHECK_EFFECT_KEYS);
    },
  });
}

export function useUpdateIssuedCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateIssuedCheckAction(input)),
    onSuccess: () => {
      invalidateKeys(qc, ISSUED_CHECK_EFFECT_KEYS);
    },
  });
}

export function useTransitionIssuedCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      to_status: "cashed" | "rejected" | "cancelled";
      event_date?: string;
    }) => runAction(() => transitionIssuedCheckAction(input)),
    onSuccess: () => {
      invalidateKeys(qc, ISSUED_CHECK_EFFECT_KEYS);
    },
  });
}
