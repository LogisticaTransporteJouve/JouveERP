"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { reconciliationKeys } from "@/features/bank-reconciliation/lib/reconciliation-keys";
import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { managementKeys } from "@/features/management/lib/management-keys";
import { tasksKeys } from "@/features/tasks/lib/tasks-keys";
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  copyTaxDocumentsFromPreviousAction,
  createTaxDocumentAction,
  getIvaPositionEstimateAction,
  listTaxAccountOptionsAction,
  listTaxDocumentsAction,
  payTaxDocumentAction,
  setTaxDocumentStatusAction,
  updateTaxDocumentAction,
} from "../actions/tax-documents-actions";
import {
  linkTaxDocumentPaymentAction,
  listTaxPaymentCandidatesAction,
  undoTaxDocumentPaymentAction,
} from "../actions/tax-payment-link-actions";
import { taxesKeys } from "../lib/taxes-keys";
import type { LinkTaxPaymentInput } from "../schema";

export function useTaxDocuments(year: number) {
  return useSuspenseQuery({
    queryKey: taxesKeys.list(year),
    queryFn: () => runAction(() => listTaxDocumentsAction({ year })),
  });
}

/** Only fetched for writers (the dialogs need it). */
export function useTaxAccountOptions(enabled: boolean) {
  return useQuery({
    queryKey: taxesKeys.accountOptions(),
    queryFn: () => runAction(() => listTaxAccountOptionsAction()),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useIvaEstimate() {
  return useMutation({
    mutationFn: (period: string) =>
      runAction(() => getIvaPositionEstimateAction({ period })),
  });
}

function useTaxMutation<I, O>(action: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: action,
    // A payment is a cash movement with a fiscal entry, counted in Gestión's
    // cash basis and matched against a bank line in Conciliación; the
    // due-date tasks follow the document on the next sync. Settled: a failed
    // request may still have written part of it.
    onSettled: () =>
      invalidateKeys(qc, [
        taxesKeys.all,
        tasksKeys.all,
        managementKeys.all,
        reconciliationKeys.all,
        ...CASH_KEYS,
        ...LEDGER_KEYS,
      ]),
  });
}

export function useCreateTaxDocument() {
  return useTaxMutation((input: unknown) =>
    runAction(() => createTaxDocumentAction(input)),
  );
}

export function useUpdateTaxDocument() {
  return useTaxMutation((input: unknown) =>
    runAction(() => updateTaxDocumentAction(input)),
  );
}

export function useSetTaxDocumentStatus() {
  return useTaxMutation((input: unknown) =>
    runAction(() => setTaxDocumentStatusAction(input)),
  );
}

export function usePayTaxDocument() {
  return useTaxMutation((input: unknown) =>
    runAction(() => payTaxDocumentAction(input)),
  );
}

/** Not suspense: the dialog opens over the list and pages in place. */
export function useTaxPaymentCandidates(id: string | null, page: number) {
  return useQuery({
    queryKey: taxesKeys.paymentCandidates(id ?? "", page),
    queryFn: () =>
      runAction(() => listTaxPaymentCandidatesAction({ id, page })),
    enabled: id !== null,
    placeholderData: keepPreviousData,
  });
}

export function useLinkTaxDocumentPayment() {
  return useTaxMutation((input: LinkTaxPaymentInput) =>
    runAction(() => linkTaxDocumentPaymentAction(input)),
  );
}

export function useUndoTaxDocumentPayment() {
  return useTaxMutation((id: string) =>
    runAction(() => undoTaxDocumentPaymentAction({ id })),
  );
}

export function useCopyTaxDocuments() {
  return useTaxMutation((input: unknown) =>
    runAction(() => copyTaxDocumentsFromPreviousAction(input)),
  );
}
