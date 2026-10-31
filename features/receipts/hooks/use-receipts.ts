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
import { CASH_KEYS } from "@/features/treasury/lib/cash-keys";
import { invalidateKeys } from "@/lib/query/invalidate";
import { getMutationId } from "@/lib/query/get-mutation-id";
import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { runAction } from "@/lib/query/run-action";

import {
  cancelReceiptAction,
  createReceiptAction,
  getNextReceiptNumeroAction,
  getReceiptByIdAction,
  getReceiptUsdRateAction,
  listPendingComprobantesForClientAction,
  listReceiptsAction,
  updateReceiptAction,
} from "../actions/receipts-actions";
import { RECEIPTS_LIST_LIMIT, receiptsKeys } from "../lib/receipts-keys";

export function useReceiptsList() {
  const isFiscal = useScopeIsFiscal();
  return useSuspenseQuery({
    queryKey: receiptsKeys.list(isFiscal),
    queryFn: () =>
      runAction(() =>
        listReceiptsAction({ limit: RECEIPTS_LIST_LIMIT, isFiscal }),
      ),
  });
}

/**
 * Suspense detail used by the edit dialog. Gated on `enabled` so the
 * query doesn't fire until the dialog is actually open.
 */
export function useReceiptDetail(
  id: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: receiptsKeys.detail(id),
    queryFn: () => runAction(() => getReceiptByIdAction(id)),
    enabled: options.enabled,
  });
}

/**
 * Suspense fetch of comprobantes pending payment for a client. Used inside
 * the allocations picker — the parent (form) supplies the clientId.
 */
export function usePendingComprobantes(
  clientId: string | null,
  channelId: string | null,
  excludeReceiptId?: string,
) {
  return useQuery({
    queryKey: receiptsKeys.pendingComprobantes(
      clientId ?? "_none",
      channelId ?? "_none",
      excludeReceiptId,
    ),
    queryFn: () =>
      clientId && channelId
        ? runAction(() =>
            listPendingComprobantesForClientAction(
              clientId,
              channelId,
              excludeReceiptId,
            ),
          )
        : Promise.resolve([]),
    enabled: !!clientId && !!channelId,
    staleTime: 5_000,
  });
}

export function useNextReceiptNumero(channelId: string | null) {
  const query = useQuery({
    queryKey: receiptsKeys.nextNumero(channelId ?? "_none"),
    queryFn: () =>
      runAction(() =>
        getNextReceiptNumeroAction({ channel_id: channelId ?? "" }),
      ),
    enabled: !!channelId,
  });

  return {
    next: query.data?.next ?? null,
    isFirst: query.data?.isFirst ?? false,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

/** Loaded USD rate for `date` (null: none loaded), fetched only when enabled. */
export function useReceiptUsdRate(date: string, enabled: boolean) {
  return useQuery({
    queryKey: receiptsKeys.usdRate(date),
    queryFn: () => runAction(() => getReceiptUsdRateAction(date)),
    enabled,
  });
}

// Mutations -----------------------------------------------------------------
//
// A receipt moves cash (caja, balances, treasury), allocates invoices (their
// open amount, the client's cuenta corriente and aging), may take checks
// into cartera and posts a fiscal entry. The client is not always known from
// the input, so the roots go broad.
const RECEIPT_EFFECT_KEYS = [
  receiptsKeys.all,
  ...CASH_KEYS,
  clientsKeys.all,
  agingKeys.all,
  invoicesKeys.all,
  checksKeys.all,
  ...LEDGER_KEYS,
] as const;

export function useCreateReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => createReceiptAction(input)),
    onSuccess: () => {
      invalidateKeys(qc, RECEIPT_EFFECT_KEYS);
    },
  });
}

export function useUpdateReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => updateReceiptAction(input)),
    onSuccess: (_data, variables) => {
      invalidateKeys(qc, RECEIPT_EFFECT_KEYS);
      const id = getMutationId(variables);
      if (id) qc.invalidateQueries({ queryKey: receiptsKeys.detail(id) });
    },
  });
}

export function useCancelReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string }) =>
      runAction(() => cancelReceiptAction(input)),
    onSuccess: (_data, variables) => {
      invalidateKeys(qc, RECEIPT_EFFECT_KEYS);
      qc.invalidateQueries({ queryKey: receiptsKeys.detail(variables.id) });
    },
  });
}
