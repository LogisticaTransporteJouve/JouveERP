import { redirect } from "next/navigation";

import { PreviewPdfPanel } from "@/features/afip-admin/components/preview-pdf-panel";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { getServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function PreviewPdfPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "afip:admin")) {
    redirect("/dashboard");
  }

  const supabase = getServiceClient();
  const { data: rows } = await supabase
    .from("invoices")
    .select(
      "id, kind, letter, punto_venta, numero, fecha, status, channel_id, imp_total",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Preview de PDF
        </h1>
        <p className="text-sm text-muted-foreground">
          Renderiza el PDF de un comprobante existente sin emitir nada nuevo.
          Útil para iterar la plantilla.
        </p>
      </div>
      <PreviewPdfPanel comprobantes={rows ?? []} />
    </div>
  );
}
