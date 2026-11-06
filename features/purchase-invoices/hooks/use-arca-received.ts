"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { runAction } from "@/lib/query/run-action";

import {
  createPurchaseInvoiceFromReceivedAction,
  discardReceivedVoucherAction,
  getReceivedVoucherCountsAction,
  listReceivedVouchersAction,
  restoreReceivedVoucherAction,
  uploadReceivedExportAction,
} from "../actions/arca-received-actions";
import {
  getArcaSyncStatusAction,
  requestArcaReceivedSyncAction,
} from "../actions/arca-received-sync-actions";
import { syncPhase } from "@/lib/afip/arca-sync-run";
import type { PurchaseInvoiceCreateRawInput } from "../lib/purchase-invoice-draft";
import {
  arcaReceivedKeys,
  purchaseInvoicesKeys,
} from "../lib/purchase-invoices-keys";
import type {
  ArcaGapTarget,
  ReceivedVoucher,
  ReceivedVoucherStatus,
} from "../schema";

const FIRST_PAGE: { fecha: string; id: string } | null = null;

export function useReceivedVouchers(status: ReceivedVoucherStatus) {
  const query = useSuspenseInfiniteQuery({
    queryKey: arcaReceivedKeys.list(status),
    queryFn: ({ pageParam }) =>
      runAction(() =>
        listReceivedVouchersAction({ status, cursor: pageParam }),
      ),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last) => last.nextCursor,
  });
  const vouchers = useMemo<ReceivedVoucher[]>(
    () => query.data.pages.flatMap((p) => p.vouchers),
    [query.data],
  );
  return { ...query, vouchers };
}

export function useReceivedVoucherCounts(enabled = true) {
  return useQuery({
    queryKey: arcaReceivedKeys.counts(),
    queryFn: () => runAction(() => getReceivedVoucherCountsAction()),
    enabled,
  });
}

export function useInvalidateTray() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: arcaReceivedKeys.all });
}

export function useUploadReceivedExport() {
  const invalidate = useInvalidateTray();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set("file", file);
      return runAction(() => uploadReceivedExportAction(form));
    },
    onSettled: invalidate,
  });
}

export function useDiscardReceivedVoucher() {
  const invalidate = useInvalidateTray();
  return useMutation({
    mutationFn: (input: { voucherId: string; reason?: string }) =>
      runAction(() => discardReceivedVoucherAction(input)),
    onSettled: invalidate,
  });
}

export function useRestoreReceivedVoucher() {
  const invalidate = useInvalidateTray();
  return useMutation({
    mutationFn: (voucherId: string) =>
      runAction(() => restoreReceivedVoucherAction({ voucherId })),
    onSettled: invalidate,
  });
}

/** The draft's save for an ARCA voucher: the form's own create mutation
 *  calls it, and refreshes purchases (the tray nests under them). */
export function useSubmitReceivedVoucher(voucherId: string) {
  const qc = useQueryClient();
  return (
    invoice: PurchaseInvoiceCreateRawInput,
    options?: { arcaGapTarget?: ArcaGapTarget },
  ) =>
    runAction(() =>
      createPurchaseInvoiceFromReceivedAction({
        voucherId,
        invoice,
        gapTarget: options?.arcaGapTarget ?? null,
      }),
    ).finally(() =>
      qc.invalidateQueries({ queryKey: purchaseInvoicesKeys.all }),
    );
}

const SYNC_POLL_MS = 4000;

/** The ARCA user's state and its last run, polled while a run is pending. */
export function useArcaSyncStatus() {
  return useQuery({
    queryKey: arcaReceivedKeys.syncStatus(),
    queryFn: () => runAction(() => getArcaSyncStatusAction()),
    refetchInterval: (query) => {
      const sync = query.state.data?.sync;
      if (!sync) return false;
      const phase = syncPhase(sync, Date.now());
      return phase === "waiting" || phase === "running" ? SYNC_POLL_MS : false;
    },
  });
}

export function useRequestArcaSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { fromMonth: string; toMonth: string }) =>
      runAction(() => requestArcaReceivedSyncAction(input)),
    // The status starts polling once it sees the request.
    onSettled: () =>
      qc.invalidateQueries({ queryKey: arcaReceivedKeys.syncStatus() }),
  });
}
