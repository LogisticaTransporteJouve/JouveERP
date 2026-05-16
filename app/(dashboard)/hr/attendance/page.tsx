import { redirect } from "next/navigation";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

// Redirige al mes actual.
export default async function AttendanceIndexPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:read")) {
    redirect("/dashboard");
  }
  const today = new Date();
  redirect(`/hr/attendance/${today.getFullYear()}/${today.getMonth() + 1}`);
}
