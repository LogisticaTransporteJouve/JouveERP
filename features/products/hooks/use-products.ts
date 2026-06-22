"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  createProductAction,
  deleteProductAction,
  listProductsAction,
  setProductActiveAction,
  updateProductAction,
} from "../actions/products-actions";
import { productsKeys } from "../lib/products-keys";

export function useProducts() {
  return useSuspenseQuery({
    queryKey: productsKeys.list(),
    queryFn: () => runAction(() => listProductsAction()),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: productsKeys.all });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => createProductAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => updateProductAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useSetProductActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; is_active: boolean }) =>
      runAction(() => setProductActiveAction(input)),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runAction(() => deleteProductAction({ id })),
    onSuccess: () => invalidate(qc),
  });
}
