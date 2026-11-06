import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getArcaWebAccountAction } from "@/features/afip-admin/actions/arca-web-account-actions";
import { ArcaWebAccountPanel } from "@/features/afip-admin/components/arca-web-account-panel";
import { afipAdminKeys } from "@/features/afip-admin/lib/afip-admin-keys";
import { getStrixStatusAction } from "@/features/vehicle-km/actions/strix-actions";
import { StrixAccountPanel } from "@/features/vehicle-km/components/strix-account-panel";
import { vehicleKmKeys } from "@/features/vehicle-km/lib/vehicle-km-keys";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

/** The users JouveERP signs in with at outside services (ARCA, Strix), in
 *  one place; each panel shows to whoever administers that service. */
export default async function AccessesPage() {
  const ctx = await requireUserContext();
  const arca = userCan(ctx.access, "afip:admin");
  const strix = userCan(ctx.access, "fleet_km:admin");
  if (!arca && !strix) redirect("/dashboard");

  const dehydratedState = await prefetchQueries([
    ...(arca
      ? [
          {
            queryKey: afipAdminKeys.arcaWebAccount(),
            queryFn: () => runAction(() => getArcaWebAccountAction()),
          },
        ]
      : []),
    ...(strix
      ? [
          {
            queryKey: vehicleKmKeys.strix(),
            queryFn: () => runAction(() => getStrixStatusAction()),
          },
        ]
      : []),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Accesos</h1>
        <p className="text-sm text-muted-foreground">
          Los usuarios con los que JouveERP entra a servicios externos para
          traer datos solo. Las claves se guardan cifradas y nunca se muestran.
        </p>
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Skeleton className="h-24 w-full" />}>
          {arca && <ArcaWebAccountPanel />}
          {strix && <StrixAccountPanel />}
        </Suspense>
      </Hydrate>
    </div>
  );
}
