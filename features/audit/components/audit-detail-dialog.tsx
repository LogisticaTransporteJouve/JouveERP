"use client";

import { Suspense } from "react";

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
import type { AuditListItem } from "../lib/ai-turns";
import { MASK } from "../lib/mask";
import { auditGroupLabel } from "../lib/registry";

import { AuditSubjectLink } from "./audit-subject-link";

/** One row in full: who, when, what, about what, and the technical detail
 *  (ids, the assistant's session and tool ids, the payload) with the
 *  sensitive values already masked by the server. */
export function AuditDetailDialog({
  item,
  onOpenChange,
}: {
  item: AuditListItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">
                <Suspense fallback={<Skeleton className="h-5 w-48" />}>
                  <ActorName item={item} />
                </Suspense>{" "}
                <span className="font-normal">{item.sentence}</span>
              </DialogTitle>
              <DialogDescription>
                {item.kind === "event"
                  ? auditGroupLabel(item.group)
                  : "Asistente IA"}{" "}
                · {formatArgentineDateTime(item.ts)}
              </DialogDescription>
            </DialogHeader>
            {item.kind === "event" ? (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Sobre qué</dt>
                  <dd>
                    <AuditSubjectLink subject={item.subject} />
                  </dd>
                </dl>
                <TechnicalDetail
                  value={{
                    event_type: item.event_type,
                    target_resource_id: item.target_resource_id,
                    target_user_id: item.target_user_id,
                    payload: item.payload,
                  }}
                />
              </>
            ) : (
              <>
                <ol className="divide-y rounded-md border text-sm">
                  {item.calls
                    .slice()
                    .reverse()
                    .map((call) => (
                      <li key={call.id} className="flex gap-3 px-3 py-2">
                        <span className="text-muted-foreground w-12 shrink-0 tabular-nums">
                          {formatArgentineDateTime(call.ts).slice(-5)}
                        </span>
                        <span>{call.sentence}</span>
                      </li>
                    ))}
                </ol>
                <TechnicalDetail
                  value={item.calls.map((call) => ({
                    id: call.id,
                    ts: call.ts,
                    payload: call.payload,
                  }))}
                />
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TechnicalDetail({ value }: { value: unknown }) {
  return (
    <details className="space-y-1">
      <summary className="cursor-pointer text-sm font-medium">
        Detalle técnico
      </summary>
      <pre className="bg-muted/40 mt-2 max-h-96 overflow-auto rounded-md border p-3 text-xs break-all whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
      <p className="text-muted-foreground text-xs">
        CBU, CUIL, claves y tokens se muestran como {MASK}.
      </p>
    </details>
  );
}

function ActorName({ item }: { item: AuditListItem }) {
  const names = useAuditUserNames();
  return <>{auditActorLabel(item, names)}</>;
}
