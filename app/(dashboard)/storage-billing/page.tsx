import { redirect } from "next/navigation";

import { StorageBillingReport } from "@/features/storage-billing/components/storage-billing-report";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function StorageBillingRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "storage_billing:read")) {
    redirect("/dashboard");
  }
  return <StorageBillingReport />;
}
