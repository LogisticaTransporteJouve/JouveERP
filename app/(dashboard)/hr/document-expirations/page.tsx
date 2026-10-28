import { redirect } from "next/navigation";

import { DocumentExpirationsPage } from "@/features/employee-documents/components/document-expirations-page";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function HrDocumentExpirationsPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    redirect("/dashboard");
  }
  return <DocumentExpirationsPage />;
}
