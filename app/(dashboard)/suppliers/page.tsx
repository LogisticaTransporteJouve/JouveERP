import { redirect } from "next/navigation";

import { listSupplierCategoriesAction } from "@/features/supplier-categories/actions/supplier-categories-actions";
import { supplierCategoriesKeys } from "@/features/supplier-categories/lib/supplier-categories-keys";
import { searchSuppliersAction } from "@/features/suppliers/actions/suppliers-actions";
import { SuppliersTable } from "@/features/suppliers/components/suppliers-table";
import {
  SUPPLIERS_PAGE_SIZE,
  suppliersKeys,
} from "@/features/suppliers/lib/suppliers-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string; category?: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "suppliers:read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const initialQuery = (params.q ?? "").trim();
  const initialOnlyActive = params.inactive !== "1";
  const initialCategoryId = params.category?.trim() || null;

  const filters = {
    query: initialQuery,
    onlyActive: initialOnlyActive,
    categoryId: initialCategoryId,
  };
  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: suppliersKeys.searchInfinite(filters),
      queryFn: ({ pageParam }: { pageParam: number }) =>
        runAction(() =>
          searchSuppliersAction({
            ...filters,
            offset: pageParam,
            limit: SUPPLIERS_PAGE_SIZE,
          }),
        ),
      initialPageParam: 0,
    },
    {
      queryKey: supplierCategoriesKeys.list(false),
      queryFn: () =>
        runAction(() => listSupplierCategoriesAction({ onlyActive: false })),
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Proveedores</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo único por CUIT, compartido entre Logística Jouve y DZ
            Instalaciones.
          </p>
        </div>
      </div>
      <Hydrate state={dehydratedState}>
        <SuppliersTable
          actorAccess={ctx.access}
          initialQuery={initialQuery}
          initialOnlyActive={initialOnlyActive}
          initialCategoryId={initialCategoryId}
        />
      </Hydrate>
    </div>
  );
}
