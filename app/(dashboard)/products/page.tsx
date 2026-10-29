import { redirect } from "next/navigation";

import { listClientsAction } from "@/features/clients/actions/clients-actions";
import { listProductsAction } from "@/features/products/actions/products-actions";
import { ProductsTable } from "@/features/products/components/products-table";
import { productsKeys } from "@/features/products/lib/products-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function ProductsPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "products:read")) {
    redirect("/dashboard");
  }

  const [dehydratedState, clientsRes] = await Promise.all([
    prefetchQueries([
      {
        queryKey: productsKeys.list(),
        queryFn: () => runAction(() => listProductsAction()),
      },
    ]),
    listClientsAction(),
  ]);

  const clientOptions = clientsRes.ok
    ? clientsRes.data.map((c) => ({ id: c.id, legal_name: c.legal_name }))
    : [];

  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <ProductsTable clientOptions={clientOptions} />
      </div>
    </Hydrate>
  );
}
