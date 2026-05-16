import { redirect } from "next/navigation";

import { LibroIvaComprasPageContent } from "@/features/libro-iva/components/libro-iva-compras-page";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LibroIvaComprasPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const channelsRes = await supabase
    .from("invoicing_channels")
    .select("id, name")
    .eq("is_active", true)
    .eq("is_fiscal", true)
    .order("name");

  return <LibroIvaComprasPageContent channels={channelsRes.data ?? []} />;
}
