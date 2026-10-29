import { redirect } from "next/navigation";

import { LibroIvaVentasPageContent } from "@/features/libro-iva/components/libro-iva-ventas-page";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LibroIvaVentasPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const channelsRes = await supabase
    .from("invoicing_channels")
    .select("id, name")
    .eq("is_active", true)
    .eq("is_fiscal", true)
    .order("name");

  return <LibroIvaVentasPageContent channels={channelsRes.data ?? []} />;
}
