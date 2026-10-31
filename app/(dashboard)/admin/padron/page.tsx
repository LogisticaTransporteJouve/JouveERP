import { redirect } from "next/navigation";

import { PadronLookup } from "@/features/clients/components/padron-lookup";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function PadronTestPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "padron:lookup")) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Padrón AFIP</h1>
        <p className="text-sm text-muted-foreground">
          Consulta directa a la constancia de inscripción de AFIP (A5). Cacheada
          24 h y limitada a 60 consultas/hora por usuario.
        </p>
      </div>
      <PadronLookup />
    </div>
  );
}
