import { redirect } from "next/navigation";

import { listSupplierCategoriesAction } from "@/features/supplier-categories/actions/supplier-categories-actions";
import { SupplierCategoriesTable } from "@/features/supplier-categories/components/supplier-categories-table";
import { supplierCategoriesKeys } from "@/features/supplier-categories/lib/supplier-categories-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function SupplierCategoriesPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:read")) {
    redirect("/dashboard");
  }

  const dehydratedState = await prefetchQueries([
    {
      queryKey: supplierCategoriesKeys.list(false),
      queryFn: () => runAction(() => listSupplierCategoriesAction({ onlyActive: false })),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <SupplierCategoriesTable />
      </div>
    </Hydrate>
  );
}
