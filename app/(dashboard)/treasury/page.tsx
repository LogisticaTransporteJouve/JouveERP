import { redirect } from "next/navigation";

import { TreasuryPage } from "@/features/treasury/components/treasury-page";
import { treasurySummaryQuery } from "@/features/treasury/lib/treasury-queries";
import { requireUserContext } from "@/lib/auth/context";
import { TREASURY_PERMISSIONS, userCanAll } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";

export const dynamic = "force-dynamic";

export default async function TreasuryRoute() {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, TREASURY_PERMISSIONS)) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([treasurySummaryQuery()]);
  return (
    <Hydrate state={dehydratedState}>
      <TreasuryPage />
    </Hydrate>
  );
}
