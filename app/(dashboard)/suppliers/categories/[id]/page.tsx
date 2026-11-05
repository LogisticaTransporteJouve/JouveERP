import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { getSupplierCategoryAction } from "@/features/supplier-categories/actions/supplier-categories-actions";
import { SupplierCategoryDetail } from "@/features/supplier-categories/components/supplier-category-detail";
import {
  categoryPurchasesQuery,
  categorySpendQuery,
} from "@/features/supplier-categories/lib/category-detail-queries";
import {
  categoryPeriodRange,
  parseCategoryPeriodParams,
} from "@/features/supplier-categories/lib/category-period";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { readScopeCookie } from "@/lib/scope-server";

export const dynamic = "force-dynamic";

export default async function SupplierCategoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "suppliers:read")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const result = await getSupplierCategoryAction(id);
  if (!result.ok) throw new Error(result.error);
  if (!result.data) notFound();
  const category = result.data;

  const search = await searchParams;
  const period = parseCategoryPeriodParams(search);
  const range = categoryPeriodRange(period);
  const scope = await readScopeCookie();
  const canReadPurchases = userCan(ctx.access, "purchase_invoices:read");

  const dehydratedState = await prefetchQueries(
    canReadPurchases
      ? [
          categorySpendQuery(id, range, scope),
          categoryPurchasesQuery(id, range, scope),
        ]
      : [],
  );

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/suppliers">Proveedores</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/suppliers/categories">
              Categorías
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{category.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {category.name}
        </h1>
        {category.is_active ? (
          <Badge variant="secondary">Activa</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Inactiva
          </Badge>
        )}
      </div>

      <Hydrate state={dehydratedState}>
        <SupplierCategoryDetail
          categoryId={id}
          initialPeriod={period}
          canReadPurchases={canReadPurchases}
        />
      </Hydrate>
    </div>
  );
}
