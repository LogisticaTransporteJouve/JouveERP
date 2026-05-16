"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { suppliersKeys } from "@/features/suppliers/lib/suppliers-keys";
import { runAction } from "@/lib/query/run-action";

import {
  createSupplierCategoryAction,
  deleteSupplierCategoryAction,
  listSupplierCategoriesAction,
  updateSupplierCategoryAction,
} from "../actions/supplier-categories-actions";
import { supplierCategoriesKeys } from "../lib/supplier-categories-keys";

export function useSupplierCategories(
  options: { onlyActive?: boolean } = {},
) {
  const onlyActive = options.onlyActive ?? false;
  return useSuspenseQuery({
    queryKey: supplierCategoriesKeys.list(onlyActive),
    queryFn: () =>
      runAction(() => listSupplierCategoriesAction({ onlyActive })),
  });
}

function invalidateCategoryEffects(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: supplierCategoriesKeys.all });
  qc.invalidateQueries({ queryKey: suppliersKeys.all });
}

export function useCreateSupplierCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createSupplierCategoryAction(input)),
    onSuccess: () => invalidateCategoryEffects(qc),
  });
}

export function useUpdateSupplierCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateSupplierCategoryAction(input)),
    onSuccess: () => invalidateCategoryEffects(qc),
  });
}

export function useDeleteSupplierCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => deleteSupplierCategoryAction({ id })),
    onSuccess: () => invalidateCategoryEffects(qc),
  });
}
