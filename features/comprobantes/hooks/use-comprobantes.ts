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
  getComprobanteDetailAction,
  getInvoiceStatusAction,
  issueFiscalInvoiceAction,
  listComprobantesAction,
  listEnabledPosAction,
  regeneratePdfAction,
  type ComprobanteListItem,
  type InvoiceStatus,
} from "../actions/comprobantes-actions";
import { comprobantesKeys } from "../lib/comprobantes-keys";
import type { ComprobanteStatus } from "../schema";

export const COMPROBANTES_PAGE_SIZE = 50;

const TERMINAL_STATES: ComprobanteStatus[] = [
  "emitted",
  "failed",
  "cancelled",
];

export function useComprobantesSearchInfinite(filters: {
  channel: string | null;
  status: ComprobanteStatus | null;
  query: string;
}) {
  const query = useSuspenseInfiniteQuery({
    queryKey: comprobantesKeys.searchInfinite(filters),
    queryFn: ({ pageParam }) =>
      runAction(() =>
        listComprobantesAction({
          channel_id: filters.channel,
          status: filters.status,
          query: filters.query,
          offset: pageParam,
          limit: COMPROBANTES_PAGE_SIZE,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage: {
      items: ComprobanteListItem[];
      nextOffset: number | null;
    }) => lastPage.nextOffset ?? undefined,
  });

  const items = useMemo<ComprobanteListItem[]>(
    () => query.data.pages.flatMap((page) => page.items),
    [query.data],
  );

  return { ...query, items };
}

export function useComprobanteDetail(id: string) {
  return useSuspenseQuery({
    queryKey: comprobantesKeys.detail(id),
    queryFn: () => runAction(() => getComprobanteDetailAction(id)),
  });
}

/**
 * Polling hook for the detail-page status badge. Refetches every 1.5s
 * while the status is non-terminal (draft / emitting); stops once it
 * lands on emitted / failed / cancelled. The detail query (the page-level
 * useComprobanteDetail) is invalidated on terminal transitions so CAE,
 * pdf_url and observaciones reload.
 */
export function useInvoiceStatusPoll(
  id: string,
  initialStatus: ComprobanteStatus,
) {
  const qc = useQueryClient();
  const initialDataRef = useMemo<InvoiceStatus>(
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

  return useQuery<InvoiceStatus, Error>({
    queryKey: comprobantesKeys.status(id),
    queryFn: () => runAction(() => getInvoiceStatusAction(id)),
    initialData: initialDataRef,
    refetchInterval: (query) => {
      const status = query.state.data?.status as ComprobanteStatus | undefined;
      if (!status) return 1500;
      return TERMINAL_STATES.includes(status) ? false : 1500;
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
    notifyOnChangeProps: ["data"],
    // When the polled status flips to terminal, refresh the detail query so
    // the page picks up CAE, pdf_url, observaciones in one go.
    structuralSharing: (oldData, newData) => {
      const oldStatus = (oldData as InvoiceStatus | undefined)?.status as
        | ComprobanteStatus
        | undefined;
      const newStatus = (newData as InvoiceStatus).status as
        | ComprobanteStatus
        | undefined;
      if (
        oldStatus &&
        newStatus &&
        oldStatus !== newStatus &&
        TERMINAL_STATES.includes(newStatus)
      ) {
        qc.invalidateQueries({ queryKey: comprobantesKeys.detail(id) });
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
    queryKey: comprobantesKeys.enabledPos(channelId ?? "_none"),
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
      qc.invalidateQueries({ queryKey: comprobantesKeys.all });
    },
  });
}

export function useRegeneratePdf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => regeneratePdfAction(id)),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: comprobantesKeys.detail(id) });
    },
  });
}
