import { redirect } from "next/navigation";

import { VacationsOverview } from "@/features/hr/components/vacations-overview";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function HrVacationsPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    redirect("/dashboard");
  }
  return (
    <VacationsOverview canSetVacations={userCan(ctx.access, "hr:admin")} />
  );
}
