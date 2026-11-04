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
import type { PurchaseInvoiceCreateRawInput } from "../lib/purchase-invoice-draft";
import {
  arcaReceivedKeys,
  purchaseInvoicesKeys,
} from "../lib/purchase-invoices-keys";
import type { ReceivedVoucher, ReceivedVoucherStatus } from "../schema";

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

function useInvalidateTray() {
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
  return (invoice: PurchaseInvoiceCreateRawInput) =>
    runAction(() =>
      createPurchaseInvoiceFromReceivedAction({ voucherId, invoice }),
    ).finally(() =>
      qc.invalidateQueries({ queryKey: purchaseInvoicesKeys.all }),
    );
}
