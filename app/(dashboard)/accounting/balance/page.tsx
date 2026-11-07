import { redirect } from "next/navigation";

import { BalancePage } from "@/features/balance/components/balance-page";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { readFiscalYearStartMonth } from "@/lib/fiscal-year-settings";

export const dynamic = "force-dynamic";

export default async function BalancePageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    redirect("/dashboard");
  }
  const startMonth = await readFiscalYearStartMonth(ctx.userId);
  if (!startMonth.ok) throw new Error(startMonth.error);
  return <BalancePage fiscalYearStartMonth={startMonth.data} />;
}
