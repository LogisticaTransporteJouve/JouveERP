"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { ResolvedPeriod } from "@/lib/list-period";
import type { FiscalFilter } from "@/lib/scope";

import {
  categoryPurchasesQuery,
  categorySpendQuery,
} from "../lib/category-detail-queries";

// Not suspense: each section shows its own failure with «Reintentar» and keeps
// the previous period's figures while the next one loads.

export function useSupplierCategorySpend(
  categoryId: string,
  range: ResolvedPeriod,
  scope: FiscalFilter,
  enabled: boolean,
) {
  return useQuery({
    ...categorySpendQuery(categoryId, range, scope),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useSupplierCategoryPurchases(
  categoryId: string,
  range: ResolvedPeriod,
  scope: FiscalFilter,
  enabled: boolean,
) {
  return useQuery({
    ...categoryPurchasesQuery(categoryId, range, scope),
    enabled,
    placeholderData: keepPreviousData,
  });
}
