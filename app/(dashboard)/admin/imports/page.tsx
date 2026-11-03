import { redirect } from "next/navigation";

import { listImportRunsAction } from "@/features/imports/actions/import-actions";
import { ImportsPage } from "@/features/imports/components/imports-page";
import { importsKeys } from "@/features/imports/lib/imports-keys";
import {
  HISTORIC_READ_PERMISSION,
  IMPORT_KINDS,
  IMPORT_KIND_PERMISSION,
} from "@/features/imports/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function AdminImportsPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "imports:read")) {
    redirect("/dashboard");
  }
  const importableKinds = userCan(ctx.access, "imports:write")
    ? IMPORT_KINDS.filter((k) => userCan(ctx.access, IMPORT_KIND_PERMISSION[k]))
    : [];
  const dehydratedState = await prefetchQueries([
    {
      queryKey: importsKeys.runs(),
      queryFn: () => runAction(() => listImportRunsAction()),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <ImportsPage
        importableKinds={importableKinds}
        canReadPayroll={userCan(
          ctx.access,
          HISTORIC_READ_PERMISSION.historic_payroll,
        )}
        canReadTrips={userCan(
          ctx.access,
          HISTORIC_READ_PERMISSION.historic_trips,
        )}
        today={todayInAR()}
      />
    </Hydrate>
  );
}
