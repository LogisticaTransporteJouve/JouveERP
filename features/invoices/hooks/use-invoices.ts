"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import type { ListGroup } from "@/lib/list-period";
import { invalidateKeys } from "@/lib/query/invalidate";
import { runAction } from "@/lib/query/run-action";

import {
  cancelInvoiceAction,
  getInvoiceDetailAction,
  getInvoiceListTotalsAction,
  getInvoiceStatusAction,
  issueFiscalInvoiceAction,
  listInvoicesAction,
  listEnabledPosAction,
  regeneratePdfAction,
  type InvoiceListItem,
  type InvoiceStatusSnapshot,
} from "../actions/invoices-actions";
import { billRemitoAction } from "../actions/bill-remito-actions";
import { INVOICE_EFFECT_KEYS } from "../lib/invoice-effect-keys";
import {
  invoiceListActionInput,
  type InvoiceListFilters,
} from "../lib/invoice-list-filters";
import { INVOICES_PAGE_SIZE, invoicesKeys } from "../lib/invoices-keys";
import type { InvoiceStatus } from "../schema";

export { INVOICES_PAGE_SIZE };

const TERMINAL_STATES: InvoiceStatus[] = ["emitted", "failed", "cancelled"];

export function useInvoicesSearchInfinite(filters: InvoiceListFilters) {
  const query = useSuspenseInfiniteQuery({
    queryKey: invoicesKeys.searchInfinite(filters),
    queryFn: ({ pageParam }) =>
      runAction(() =>
        listInvoicesAction(
          invoiceListActionInput(filters, pageParam, INVOICES_PAGE_SIZE),
        ),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage: {
      items: InvoiceListItem[];
      nextOffset: number | null;
    }) => lastPage.nextOffset ?? undefined,
  });

  const items = useMemo<InvoiceListItem[]>(
    () => query.data.pages.flatMap((page) => page.items),
    [query.data],
  );

  return { ...query, items };
}

/** Subtotals of a grouped view (the "Por día" header rows); nothing to
 *  fetch for the plain list. Never suspends: the rows render first and the
 *  headers fill in. */
export function useInvoiceListTotals(
  filters: InvoiceListFilters,
  group: ListGroup | null,
) {
  return useQuery({
    queryKey: invoicesKeys.totals(filters, group),
    queryFn: () =>
      runAction(() => getInvoiceListTotalsAction({ ...filters, group })),
    enabled: group !== null,
  });
}

export function useInvoiceDetail(id: string) {
  return useSuspenseQuery({
    queryKey: invoicesKeys.detail(id),
    queryFn: () => runAction(() => getInvoiceDetailAction(id)),
  });
}

/**
 * Polling hook for the detail-page status badge. Refetches every 1.5s
 * while the status is non-terminal (draft / emitting); stops once it
 * lands on emitted / failed / cancelled. The detail query (the page-level
 * useInvoiceDetail) is invalidated on terminal transitions so CAE,
 * pdf_hash and observaciones reload.
 */
export function useInvoiceStatusPoll(id: string, initialStatus: InvoiceStatus) {
  const qc = useQueryClient();
  const initialDataRef = useMemo<InvoiceStatusSnapshot>(
    () => ({
      id,
      status: initialStatus,
      cae: null,
      cae_vencimiento: null,
      numero: null,
      punto_venta: 0,
      emitted_at: null,
      afip_observaciones: null,
    }),
    [id, initialStatus],
  );

  return useQuery<InvoiceStatusSnapshot, Error>({
    queryKey: invoicesKeys.status(id),
    queryFn: () => runAction(() => getInvoiceStatusAction(id)),
    initialData: initialDataRef,
    refetchInterval: (query) => {
      const status = query.state.data?.status as InvoiceStatus | undefined;
      if (!status) return 1500;
      return TERMINAL_STATES.includes(status) ? false : 1500;
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
    notifyOnChangeProps: ["data"],
    // When the polled status flips to terminal, refresh the detail query so
    // the page picks up CAE, pdf_hash, observaciones in one go.
    structuralSharing: (oldData, newData) => {
      const oldStatus = (oldData as InvoiceStatusSnapshot | undefined)
        ?.status as InvoiceStatus | undefined;
      const newStatus = (newData as InvoiceStatusSnapshot).status as
        InvoiceStatus | undefined;
      if (
        oldStatus &&
        newStatus &&
        oldStatus !== newStatus &&
        TERMINAL_STATES.includes(newStatus)
      ) {
        qc.invalidateQueries({ queryKey: invoicesKeys.detail(id) });
        invalidateKeys(qc, INVOICE_EFFECT_KEYS);
      }
      return newData;
    },
  });
}

export function useEnabledPos(
  channelId: string | null,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: invoicesKeys.enabledPos(channelId ?? "_none"),
    queryFn: () =>
      channelId
        ? runAction(() => listEnabledPosAction(channelId))
        : Promise.resolve([]),
    enabled: options.enabled !== false && !!channelId,
  });
}

/**
 * Search for invoices eligible as the origin of an NC/ND: only `emitted`
 * facturas of an active fiscal channel, filtered server-side so the 25 rows
 * are all eligible. The invoices list page consumes this from the NC/ND
 * dialog.
 */
export function useOriginSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: invoicesKeys.originSearch(query),
    queryFn: async (): Promise<InvoiceListItem[]> => {
      const res = await runAction(() =>
        listInvoicesAction({
          status: "emitted",
          kind: "factura",
          isFiscal: true,
          activeChannelOnly: true,
          query: query.trim().length > 0 ? query : null,
          limit: 25,
        }),
      );
      return res.items;
    },
    enabled,
    staleTime: 5_000,
  });
}

/**
 * On-demand fetch of the detail. No `useSuspenseQuery` because the caller
 * (NewNcNdDialog) controls the loading state inline while it waits for the
 * detail of the just-picked invoice.
 */
export function useInvoiceDetailOnDemand(id: string | null) {
  return useQuery({
    queryKey: id ? invoicesKeys.detail(id) : ["invoices", "detail", null],
    queryFn: () =>
      id ? runAction(() => getInvoiceDetailAction(id)) : Promise.reject(),
    enabled: !!id,
  });
}

// Mutations -----------------------------------------------------------------

export function useIssueFiscalInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof issueFiscalInvoiceAction>[0]) =>
      runAction(() => issueFiscalInvoiceAction(input)),
    // Internal invoices are emitted here; fiscal ones may still be queued,
    // and the status poll invalidates again when they settle.
    onSuccess: () => invalidateKeys(qc, INVOICE_EFFECT_KEYS),
  });
}

export function useBillRemito() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof billRemitoAction>[0]) =>
      runAction(() => billRemitoAction(input)),
    onSuccess: () => invalidateKeys(qc, INVOICE_EFFECT_KEYS),
  });
}

export function useRegeneratePdf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => regeneratePdfAction(id)),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: invoicesKeys.detail(id) });
    },
  });
}

export function useCancelInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => cancelInvoiceAction({ id })),
    onSettled: () => invalidateKeys(qc, INVOICE_EFFECT_KEYS),
  });
}
