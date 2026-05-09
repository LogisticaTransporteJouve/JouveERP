import { redirect } from "next/navigation";

import { ComprobantesTable } from "@/features/comprobantes/components/comprobantes-table";
import {
  COMPROBANTE_STATUSES,
  type ComprobanteStatus,
} from "@/features/comprobantes/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { getServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

function asStatus(value: string | undefined): ComprobanteStatus | null {
  if (!value) return null;
  return (COMPROBANTE_STATUSES as readonly string[]).includes(value)
    ? (value as ComprobanteStatus)
    : null;
}

export default async function ComprobantesPage({
  searchParams,
}: {
  searchParams: Promise<{
    channel?: string;
    status?: string;
    q?: string;
  }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "invoices:read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const supabase = getServiceClient();
  const { data: channels } = await supabase
    .from("invoicing_channels")
    .select("id, name, division, is_active")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Comprobantes</h1>
        <p className="text-sm text-muted-foreground">
          Facturas, notas de crédito y débito por canal.
        </p>
      </div>
      <ComprobantesTable
        actorRoles={ctx.roles}
        channels={(channels ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          division: c.division,
        }))}
        initialChannel={params.channel ?? null}
        initialStatus={asStatus(params.status)}
        initialQuery={params.q ?? ""}
      />
    </div>
  );
}
