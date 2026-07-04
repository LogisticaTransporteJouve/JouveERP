import { AlertTriangle, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { listBackupsAction } from "@/features/backups/actions/backups-actions";
import { BackupsTable } from "@/features/backups/components/backups-table";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "audit:read")) {
    redirect("/dashboard");
  }

  const res = await listBackupsAction();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Backups</h1>
        <p className="text-sm text-muted-foreground">
          Dumps diarios de la base. Generados automáticamente por GitHub
          Actions a las 03:00 UTC.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card
          icon={<ShieldCheck className="size-5 text-muted-foreground" />}
          title="Política de retención"
          body="Diarios con 30 días de retención. Más viejos se borran automáticamente."
        />
        <Card
          icon={<AlertTriangle className="size-5 text-muted-foreground" />}
          title="Drill mensual recomendado"
          body="Restaurar el dump más reciente a un proyecto temporal y verificar row counts. Procedimiento en scripts/restore-backup.sh."
        />
      </div>

      {!res.ok ? (
        <div className="rounded-lg border border-border bg-muted p-4 text-sm">
          {res.error}
        </div>
      ) : (
        <BackupsTable items={res.data} />
      )}

      <div className="rounded-lg border bg-muted/20 p-4 text-xs text-muted-foreground">
        <p className="font-medium">Setup GitHub Actions:</p>
        <p>
          El workflow <code>.github/workflows/backup-daily.yml</code> necesita
          tres secrets configurados en el repo:
          <code className="ml-1">DATABASE_URL</code>,{" "}
          <code>SUPABASE_URL</code>,
          <code className="ml-1">SUPABASE_SERVICE_ROLE_KEY</code>. Opcional:
          <code className="ml-1">SLACK_WEBHOOK_URL</code> para notificaciones.
        </p>
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
