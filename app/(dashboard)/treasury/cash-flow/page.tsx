import { redirect } from "next/navigation";

import { CashFlowPage } from "@/features/treasury/components/cash-flow-page";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function CashFlowRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    redirect("/dashboard");
  }
  return <CashFlowPage />;
}
