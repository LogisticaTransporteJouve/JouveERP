import { redirect } from "next/navigation";

import { ProfitabilityReport } from "@/features/fleet-reports/components/profitability-report";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function FleetReportsRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "trips:read")) {
    redirect("/dashboard");
  }
  return <ProfitabilityReport />;
}
