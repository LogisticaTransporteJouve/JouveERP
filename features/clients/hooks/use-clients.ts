"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { agingKeys } from "@/features/aging/lib/aging-keys";
import { receiptsKeys } from "@/features/receipts/lib/receipts-keys";
import { getMutationId } from "@/lib/query/get-mutation-id";
import { invalidateKeys } from "@/lib/query/invalidate";
import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { runAction } from "@/lib/query/run-action";

import {
  clearClientOpeningBalanceAction,
  getClientAccountAction,
  getClientOpeningBalanceAction,
  setClientOpeningBalanceAction,
} from "../actions/account-actions";
import {
  createClientAction,
  deleteClientAction,
  getClientByIdAction,
  getClientReferencesAction,
  searchClientsAction,
  setClientActiveAction,
  updateClientAction,
  type SearchClientsPage,
} from "../actions/clients-actions";
import { CLIENTS_PAGE_SIZE, clientsKeys } from "../lib/clients-keys";
import type { Client } from "../schema";

export { CLIENTS_PAGE_SIZE };

/**
 * Suspense-driven infinite list. The keyspace includes the filters so each
 * (query, onlyActive) combination caches independently and useDeferredValue
 * can keep the previous filter's tree visible during transition.
 */
export function useClientsSearchInfinite(filters: {
  query: string;
  onlyActive: boolean;
}) {
  const query = useSuspenseInfiniteQuery({
    queryKey: clientsKeys.searchInfinite(filters),
    queryFn: ({ pageParam }) =>
      runAction(() =>
        searchClientsAction({
          query: filters.query,
          onlyActive: filters.onlyActive,
          offset: pageParam,
          limit: CLIENTS_PAGE_SIZE,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage: SearchClientsPage) =>
      lastPage.nextOffset ?? undefined,
  });

  const items = useMemo<Client[]>(
    () => query.data.pages.flatMap((page) => page.clients),
    [query.data],
  );

  return { ...query, items };
}

/**
 * Interactive picker search. Uses `useQuery` (not Suspense) because the
 * popover doesn't have a meaningful Suspense boundary to render — every
 * keystroke triggering a Suspense fallback would flicker the popover.
 */
export function useClientsSearch(
  filters: { query: string; onlyActive: boolean; limit: number },
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: clientsKeys.search(filters),
    queryFn: () =>
      runAction(() =>
        searchClientsAction({
          query: filters.query,
          onlyActive: filters.onlyActive,
          offset: 0,
          limit: filters.limit,
        }),
      ),
    enabled: options.enabled,
    placeholderData: (prev) => prev,
  });
}

export function useClientById(id: string) {
  return useSuspenseQuery({
    queryKey: clientsKeys.byId(id),
    queryFn: () => runAction(() => getClientByIdAction(id)),
  });
}

export function useClientReferences(
  id: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: clientsKeys.references(id),
    queryFn: () => runAction(() => getClientReferencesAction(id)),
    enabled: options.enabled,
  });
}

export function useClientAccount(id: string) {
  const isFiscal = useScopeIsFiscal();
  return useSuspenseQuery({
    queryKey: clientsKeys.accountByScope(id, isFiscal),
    queryFn: () => runAction(() => getClientAccountAction(id, { isFiscal })),
  });
}

/** The opening balance feeds the client's account, aging and the receipts
 *  picker of pending documents. */
const OPENING_BALANCE_EFFECT_KEYS = [
  clientsKeys.all,
  agingKeys.all,
  receiptsKeys.all,
] as const;

export function useClientOpeningBalance(id: string) {
  return useSuspenseQuery({
    queryKey: clientsKeys.openingBalance(id),
    queryFn: () => runAction(() => getClientOpeningBalanceAction(id)),
  });
}

export function useSetClientOpeningBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      client_id: string;
      opening_date: string;
      target_balance: number;
      notes?: string | null;
    }) => runAction(() => setClientOpeningBalanceAction(input)),
    onSuccess: () => invalidateKeys(qc, OPENING_BALANCE_EFFECT_KEYS),
  });
}

export function useClearClientOpeningBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) =>
      runAction(() => clearClientOpeningBalanceAction(clientId)),
    onSuccess: () => invalidateKeys(qc, OPENING_BALANCE_EFFECT_KEYS),
  });
}

// Mutations -----------------------------------------------------------------

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => createClientAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clientsKeys.all });
    },
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => updateClientAction(input)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: clientsKeys.all });
      const id = getMutationId(variables);
      if (id) qc.invalidateQueries({ queryKey: clientsKeys.byId(id) });
    },
  });
}

export function useSetClientActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; is_active: boolean }) =>
      runAction(() => setClientActiveAction(input)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: clientsKeys.all });
      qc.invalidateQueries({ queryKey: clientsKeys.byId(variables.id) });
    },
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deleteClientAction(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clientsKeys.all });
    },
  });
}
