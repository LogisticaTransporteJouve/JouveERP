import { redirect } from "next/navigation";

import { ProfitabilityReport } from "@/features/fleet-reports/components/profitability-report";
import { requireUserContext } from "@/lib/auth/context";
import {
  FLEET_PROFITABILITY_PERMISSIONS,
  userCanAll,
} from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function FleetReportsRoute() {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, FLEET_PROFITABILITY_PERMISSIONS)) {
    redirect("/dashboard");
  }
  return <ProfitabilityReport />;
}
