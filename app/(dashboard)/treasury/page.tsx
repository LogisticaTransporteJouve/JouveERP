import { redirect } from "next/navigation";

import { TreasuryPage } from "@/features/treasury/components/treasury-page";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function TreasuryRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    redirect("/dashboard");
  }
  return <TreasuryPage />;
}
