import { redirect } from "next/navigation";

import { listClientsAction } from "@/features/clients/actions/clients-actions";
import { listPalletsAction } from "@/features/pallets/actions/pallets-actions";
import { PalletsTable } from "@/features/pallets/components/pallets-table";
import { palletsKeys } from "@/features/pallets/lib/pallets-keys";
import { listProductsAction } from "@/features/products/actions/products-actions";
import { listWarehousesAction } from "@/features/warehouses/actions/warehouses-actions";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function PalletsPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "pallets:read")) {
    redirect("/dashboard");
  }

  const [dehydratedState, warehousesRes, clientsRes, productsRes] =
    await Promise.all([
      prefetchQueries([
        {
          queryKey: palletsKeys.list(),
          queryFn: () => runAction(() => listPalletsAction()),
        },
      ]),
      listWarehousesAction({ onlyActive: true }),
      listClientsAction(),
      listProductsAction(),
    ]);

  const warehouseOptions = warehousesRes.ok
    ? warehousesRes.data.map((w) => ({ id: w.id, name: w.name }))
    : [];
  const clientOptions = clientsRes.ok
    ? clientsRes.data.map((c) => ({ id: c.id, legal_name: c.legal_name }))
    : [];
  const productOptions = productsRes.ok
    ? productsRes.data
        .filter((p) => p.is_active)
        .map((p) => ({ id: p.id, name: p.name }))
    : [];

  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <PalletsTable
          warehouseOptions={warehouseOptions}
          clientOptions={clientOptions}
          productOptions={productOptions}
        />
      </div>
    </Hydrate>
  );
}
