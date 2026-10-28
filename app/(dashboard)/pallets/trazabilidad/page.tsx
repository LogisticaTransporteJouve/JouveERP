import { redirect } from "next/navigation";

import { listClientsAction } from "@/features/clients/actions/clients-actions";
import { listPalletsAction } from "@/features/pallets/actions/pallets-actions";
import { PalletTraceability } from "@/features/pallets/components/pallet-traceability";
import { palletsKeys } from "@/features/pallets/lib/pallets-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function PalletTraceabilityRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "pallets:read")) {
    redirect("/dashboard");
  }

  const [dehydratedState, clientsRes] = await Promise.all([
    prefetchQueries([
      {
        queryKey: palletsKeys.list(),
        queryFn: () => runAction(() => listPalletsAction()),
      },
    ]),
    listClientsAction(),
  ]);

  const clientOptions = clientsRes.ok
    ? clientsRes.data.map((c) => ({ id: c.id, legal_name: c.legal_name }))
    : [];

  return (
    <Hydrate state={dehydratedState}>
      <PalletTraceability clientOptions={clientOptions} />
    </Hydrate>
  );
}
