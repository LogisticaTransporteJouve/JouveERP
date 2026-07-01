import { redirect } from "next/navigation";

import { BalancePage } from "@/features/balance/components/balance-page";
import { listCostCentersAction } from "@/features/cost-centers/actions/cost-centers-actions";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function BalancePageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    redirect("/dashboard");
  }
  const res = await listCostCentersAction({ onlyActive: true });
  const costCenters = res.ok
    ? res.data.map((c) => ({ id: c.id, code: c.code, name: c.name }))
    : [];
  return <BalancePage costCenters={costCenters} />;
}
