import { redirect } from "next/navigation";

import { listShipmentsAction } from "@/features/shipments/actions/shipments-actions";
import { ShipmentsTable } from "@/features/shipments/components/shipments-table";
import {
  parseShipmentListParams,
  shipmentListFilter,
} from "@/features/shipments/lib/list-params";
import { shipmentsKeys } from "@/features/shipments/lib/shipments-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function CargasPageRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:read")) {
    redirect("/dashboard");
  }

  const raw = await searchParams;
  const params = parseShipmentListParams(
    Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
    ),
  );
  const filter = shipmentListFilter(params);
  const dehydratedState = await prefetchQueries([
    {
      queryKey: shipmentsKeys.list(filter),
      queryFn: () => runAction(() => listShipmentsAction(filter)),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <ShipmentsTable actorAccess={ctx.access} initialParams={params} />
      </div>
    </Hydrate>
  );
}
