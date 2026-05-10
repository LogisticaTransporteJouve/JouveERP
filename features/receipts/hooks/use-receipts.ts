"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { clientsKeys } from "@/features/clients/lib/clients-keys";
import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";
import { runAction } from "@/lib/query/run-action";

import {
  cancelReceiptAction,
  createReceiptAction,
  getNextReceiptNumeroAction,
  getReceiptByIdAction,
  listPendingComprobantesForClientAction,
  listReceiptsAction,
  updateReceiptAction,
} from "../actions/receipts-actions";
import { receiptsKeys } from "../lib/receipts-keys";

export function useReceiptsList() {
  return useSuspenseQuery({
    queryKey: receiptsKeys.list(),
    queryFn: () => runAction(() => listReceiptsAction()),
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
  excludeReceiptId?: string,
) {
  return useQuery({
    queryKey: receiptsKeys.pendingComprobantes(
      clientId ?? "_none",
      excludeReceiptId,
    ),
    queryFn: () =>
      clientId
        ? runAction(() =>
            listPendingComprobantesForClientAction(clientId, excludeReceiptId),
          )
        : Promise.resolve([]),
    enabled: !!clientId,
  });
}

export function useNextReceiptNumero(channelId: string | null) {
  const query = useQuery({
    queryKey: receiptsKeys.nextNumero(channelId ?? "_none"),
    queryFn: () =>
      runAction(() =>
        getNextReceiptNumeroAction({
          channel_id: channelId ?? "",
          // POS resolved server-side from the channel; the action signature
          // requires the param.
          punto_venta: 0,
        }),
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

// Mutations -----------------------------------------------------------------
//
// Receipt mutations also touch transactions and the client's cuenta
// corriente, so we invalidate those keys too:
//   - transactionsKeys.all  → /caja and account balances pick up new income
//     rows (or removed ones, on cancel/edit).
//   - clientsKeys.all       → cuenta corriente of any client may have
//     changed (we don't always know the clientId on create from the input
//     payload here, so we go broad — cheap because the keys nest under it).

export function useCreateReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createReceiptAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: receiptsKeys.all });
      qc.invalidateQueries({ queryKey: transactionsKeys.all });
      qc.invalidateQueries({ queryKey: clientsKeys.all });
    },
  });
}

export function useUpdateReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateReceiptAction(input)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: receiptsKeys.all });
      qc.invalidateQueries({ queryKey: transactionsKeys.all });
      qc.invalidateQueries({ queryKey: clientsKeys.all });
      const id = (variables as { id?: string }).id;
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
      qc.invalidateQueries({ queryKey: receiptsKeys.all });
      qc.invalidateQueries({ queryKey: transactionsKeys.all });
      qc.invalidateQueries({ queryKey: clientsKeys.all });
      qc.invalidateQueries({ queryKey: receiptsKeys.detail(variables.id) });
    },
  });
}
