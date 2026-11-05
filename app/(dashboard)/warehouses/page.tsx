import { redirect } from "next/navigation";

import { listStorageAreasAction } from "@/features/warehouses/actions/storage-areas-actions";
import { listWarehousesAction } from "@/features/warehouses/actions/warehouses-actions";
import { WarehousesTable } from "@/features/warehouses/components/warehouses-table";
import {
  storageAreasKeys,
  warehousesKeys,
} from "@/features/warehouses/lib/warehouses-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function WarehousesPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "warehouses:read")) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    {
      queryKey: warehousesKeys.list(false),
      queryFn: () =>
        runAction(() => listWarehousesAction({ onlyActive: false })),
    },
    {
      queryKey: storageAreasKeys.list(false),
      queryFn: () =>
        runAction(() => listStorageAreasAction({ onlyActive: false })),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <WarehousesTable actorAccess={ctx.access} />
      </div>
    </Hydrate>
  );
}
