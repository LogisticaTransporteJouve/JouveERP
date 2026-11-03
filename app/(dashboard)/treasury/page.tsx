import { redirect } from "next/navigation";

import { SoldChecksExposureCard } from "@/features/checks/components/sold-checks-exposure-card";
import { TreasuryPage } from "@/features/treasury/components/treasury-page";
import { treasurySummaryQuery } from "@/features/treasury/lib/treasury-queries";
import { requireUserContext } from "@/lib/auth/context";
import {
  TREASURY_PERMISSIONS,
  userCan,
  userCanAll,
} from "@/lib/auth/permissions";
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
      <div className="space-y-6">
        <TreasuryPage
          canCollect={userCan(ctx.access, "receipts:write")}
          canPay={userCan(ctx.access, "payment_orders:write")}
          canEditRetentions={userCan(ctx.access, "retentions:write")}
          canAdvance={
            userCan(ctx.access, "hr:write") &&
            userCan(ctx.access, "transactions:write")
          }
        />
        {userCan(ctx.access, "cheques:read") && <SoldChecksExposureCard />}
      </div>
    </Hydrate>
  );
}
