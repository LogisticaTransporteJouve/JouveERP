import { redirect } from "next/navigation";

import { listAuditFilterOptionsAction } from "@/features/audit/actions/audit-actions";
import { AuditView } from "@/features/audit/components/audit-view";
import { auditKeys } from "@/features/audit/lib/audit-keys";
import { auditEventsQuery } from "@/features/audit/lib/audit-query";
import { EMPTY_AUDIT_FILTERS } from "@/features/audit/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "audit:read")) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    { infinite: true, ...auditEventsQuery(EMPTY_AUDIT_FILTERS) },
    {
      queryKey: auditKeys.options(),
      queryFn: () => runAction(() => listAuditFilterOptionsAction()),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <AuditView />
    </Hydrate>
  );
}
