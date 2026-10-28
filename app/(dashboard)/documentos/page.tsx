import { redirect } from "next/navigation";

import { DocumentsTray } from "@/features/ai/document/components/documents-tray";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function DocumentosRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:read")) {
    redirect("/dashboard");
  }
  return <DocumentsTray />;
}
