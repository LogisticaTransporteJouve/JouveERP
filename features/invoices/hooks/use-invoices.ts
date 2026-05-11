"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { runAction } from "@/lib/query/run-action";

import {
  getInvoiceDetailAction,
  getInvoiceStatusAction,
  issueFiscalInvoiceAction,
  listInvoicesAction,
  listEnabledPosAction,
  regeneratePdfAction,
  type InvoiceListItem,
  type InvoiceStatusSnapshot,
} from "../actions/invoices-actions";
import { INVOICES_PAGE_SIZE, invoicesKeys } from "../lib/invoices-keys";
import type { InvoiceStatus } from "../schema";

export { INVOICES_PAGE_SIZE };

const TERMINAL_STATES: InvoiceStatus[] = [
  "emitted",
  "failed",
  "cancelled",
];

export function useInvoicesSearchInfinite(filters: {
  channel: string | null;
  status: InvoiceStatus | null;
  query: string;
}) {
  const query = useSuspenseInfiniteQuery({
    queryKey: invoicesKeys.searchInfinite(filters),
    queryFn: ({ pageParam }) =>
      runAction(() =>
        listInvoicesAction({
          channel_id: filters.channel,
          status: filters.status,
          query: filters.query,
          offset: pageParam,
          limit: INVOICES_PAGE_SIZE,
        }),
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
 * pdf_url and observaciones reload.
 */
export function useInvoiceStatusPoll(
  id: string,
  initialStatus: InvoiceStatus,
) {
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
    // the page picks up CAE, pdf_url, observaciones in one go.
    structuralSharing: (oldData, newData) => {
      const oldStatus = (oldData as InvoiceStatusSnapshot | undefined)
        ?.status as InvoiceStatus | undefined;
      const newStatus = (newData as InvoiceStatusSnapshot).status as
        | InvoiceStatus
        | undefined;
      if (
        oldStatus &&
        newStatus &&
        oldStatus !== newStatus &&
        TERMINAL_STATES.includes(newStatus)
      ) {
        qc.invalidateQueries({ queryKey: invoicesKeys.detail(id) });
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

// Mutations -----------------------------------------------------------------

export function useIssueFiscalInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof issueFiscalInvoiceAction>[0]) =>
      runAction(() => issueFiscalInvoiceAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invoicesKeys.all });
    },
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
