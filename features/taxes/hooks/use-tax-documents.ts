"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
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
import { taxesKeys } from "../lib/taxes-keys";

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
    // A payment is a cash movement with a fiscal entry; the due-date tasks
    // follow the document on the next sync.
    onSuccess: () =>
      invalidateKeys(qc, [
        taxesKeys.all,
        tasksKeys.all,
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

export function useCopyTaxDocuments() {
  return useTaxMutation((input: unknown) =>
    runAction(() => copyTaxDocumentsFromPreviousAction(input)),
  );
}
