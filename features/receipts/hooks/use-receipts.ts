"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

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

export function useCreateReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createReceiptAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: receiptsKeys.all });
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
      qc.invalidateQueries({ queryKey: receiptsKeys.detail(variables.id) });
    },
  });
}
