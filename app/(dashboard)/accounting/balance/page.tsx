import { redirect } from "next/navigation";

import { BalancePage } from "@/features/balance/components/balance-page";
import { listCostCentersAction } from "@/features/cost-centers/actions/cost-centers-actions";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { readFiscalYearStartMonth } from "@/lib/fiscal-year-settings";

export const dynamic = "force-dynamic";

export default async function BalancePageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    redirect("/dashboard");
  }
  const [res, startMonth] = await Promise.all([
    listCostCentersAction({ onlyActive: true }),
    readFiscalYearStartMonth(ctx.userId),
  ]);
  if (!startMonth.ok) throw new Error(startMonth.error);
  const costCenters = res.ok
    ? res.data.map((c) => ({ id: c.id, code: c.code, name: c.name }))
    : [];
  return (
    <BalancePage
      costCenters={costCenters}
      fiscalYearStartMonth={startMonth.data}
    />
  );
}
