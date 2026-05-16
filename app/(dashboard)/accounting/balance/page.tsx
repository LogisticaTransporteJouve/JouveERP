import { redirect } from "next/navigation";

import { BalancePage } from "@/features/balance/components/balance-page";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function BalancePageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    redirect("/dashboard");
  }
  return <BalancePage />;
}
