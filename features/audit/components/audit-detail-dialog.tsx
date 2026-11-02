"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatArgentineDateTime } from "@/lib/format";

import { useAuditUserNames } from "../hooks/use-audit";
import { auditActorLabel } from "../lib/actor";
import { MASK } from "../lib/mask";
import { auditModuleLabel } from "../lib/modules";
import type { AuditEventRow } from "../schema";

/** One event in full: who, when, the record and its payload, with the
 *  sensitive values already masked by the server. */
export function AuditDetailDialog({
  event,
  onOpenChange,
}: {
  event: AuditEventRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={event !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {event && (
          <>
            <DialogHeader>
              <DialogTitle className="font-mono text-base">
                {event.event_type}
              </DialogTitle>
              <DialogDescription>
                {auditModuleLabel(event.module)} ·{" "}
                {formatArgentineDateTime(event.ts)}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Quién</dt>
              <dd>
                <Suspense fallback={<Skeleton className="h-4 w-32" />}>
                  <ActorName event={event} />
                </Suspense>
              </dd>
              <dt className="text-muted-foreground">Registro</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-xs">
                  {event.target_resource_id ?? "—"}
                </span>
                {event.record_href && (
                  <Button asChild variant="ghost" size="sm">
                    <Link href={event.record_href}>
                      <ExternalLink />
                      Abrir
                    </Link>
                  </Button>
                )}
              </dd>
              {event.summary && (
                <>
                  <dt className="text-muted-foreground">Resumen</dt>
                  <dd>{event.summary}</dd>
                </>
              )}
            </dl>
            <div className="space-y-1">
              <p className="text-sm font-medium">Detalle</p>
              <pre className="bg-muted/40 max-h-96 overflow-auto rounded-md border p-3 text-xs break-all whitespace-pre-wrap">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
              <p className="text-muted-foreground text-xs">
                CBU, CUIL, claves y tokens se muestran como {MASK}.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ActorName({ event }: { event: AuditEventRow }) {
  const names = useAuditUserNames();
  return <>{auditActorLabel(event, names)}</>;
}
