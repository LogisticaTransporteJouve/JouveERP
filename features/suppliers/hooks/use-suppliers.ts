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
  createSupplierAction,
  deleteSupplierAction,
  getSupplierByIdAction,
  getSupplierReferencesAction,
  searchSuppliersAction,
  setSupplierActiveAction,
  updateSupplierAction,
  type SearchSuppliersPage,
} from "../actions/suppliers-actions";
import { SUPPLIERS_PAGE_SIZE, suppliersKeys } from "../lib/suppliers-keys";
import type { Supplier } from "../schema";

export { SUPPLIERS_PAGE_SIZE };

export function useSuppliersSearchInfinite(filters: {
  query: string;
  onlyActive: boolean;
}) {
  const query = useSuspenseInfiniteQuery({
    queryKey: suppliersKeys.searchInfinite(filters),
    queryFn: ({ pageParam }) =>
      runAction(() =>
        searchSuppliersAction({
          query: filters.query,
          onlyActive: filters.onlyActive,
          offset: pageParam,
          limit: SUPPLIERS_PAGE_SIZE,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage: SearchSuppliersPage) =>
      lastPage.nextOffset ?? undefined,
  });

  const items = useMemo<Supplier[]>(
    () => query.data.pages.flatMap((page) => page.suppliers),
    [query.data],
  );

  return { ...query, items };
}

export function useSuppliersSearch(
  filters: { query: string; onlyActive: boolean; limit: number },
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: suppliersKeys.search(filters),
    queryFn: () =>
      runAction(() =>
        searchSuppliersAction({
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

export function useSupplierById(id: string) {
  return useSuspenseQuery({
    queryKey: suppliersKeys.byId(id),
    queryFn: () => runAction(() => getSupplierByIdAction(id)),
  });
}

export function useSupplierReferences(
  id: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: suppliersKeys.references(id),
    queryFn: () => runAction(() => getSupplierReferencesAction(id)),
    enabled: options.enabled,
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createSupplierAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: suppliersKeys.all });
    },
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateSupplierAction(input)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: suppliersKeys.all });
      const id = (variables as { id?: string }).id;
      if (id) qc.invalidateQueries({ queryKey: suppliersKeys.byId(id) });
    },
  });
}

export function useSetSupplierActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; is_active: boolean }) =>
      runAction(() => setSupplierActiveAction(input)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: suppliersKeys.all });
      qc.invalidateQueries({ queryKey: suppliersKeys.byId(variables.id) });
    },
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deleteSupplierAction(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: suppliersKeys.all });
    },
  });
}
