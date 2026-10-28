import { redirect } from "next/navigation";

import { listClientsAction } from "@/features/clients/actions/clients-actions";
import { listStorageTariffsAction } from "@/features/storage-tariffs/actions/storage-tariffs-actions";
import { StorageTariffsTable } from "@/features/storage-tariffs/components/storage-tariffs-table";
import { storageTariffsKeys } from "@/features/storage-tariffs/lib/storage-tariffs-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function StorageTariffsPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "storage_billing:read")) {
    redirect("/dashboard");
  }

  const [dehydratedState, clientsRes] = await Promise.all([
    prefetchQueries([
      {
        queryKey: storageTariffsKeys.list(),
        queryFn: () => runAction(() => listStorageTariffsAction()),
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
        <StorageTariffsTable clientOptions={clientOptions} />
      </div>
    </Hydrate>
  );
}
