"use client";

import { Eye } from "lucide-react";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatArgentineDateTime } from "@/lib/format";

import { useAuditUserNames, useRecordHistory } from "../hooks/use-audit";
import { auditActorLabel } from "../lib/actor";
import type { AuditListItem } from "../lib/ai-turns";
import { RECORD_HISTORY_LIMIT } from "../schema";

import { AuditDetailDialog } from "./audit-detail-dialog";

/**
 * A record's «Historial» from audit_events, for any detail page: who created,
 * edited, issued or cancelled it and when, in the same words as Admin ›
 * Auditoría. Render it only for users with audit:read: the action refuses
 * everyone else.
 */
export function RecordHistory({ resourceId }: { resourceId: string }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">Historial</h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Quién hizo qué sobre este registro, lo más reciente primero.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="m-4 h-16" />}>
        <RecordHistoryList resourceId={resourceId} />
      </Suspense>
    </div>
  );
}

function RecordHistoryList({ resourceId }: { resourceId: string }) {
  const { data } = useRecordHistory(resourceId);
  const names = useAuditUserNames();
  const [selected, setSelected] = useState<AuditListItem | null>(null);

  if (data.length === 0) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        Sin eventos registrados.
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y">
        {data.map((event) => (
          <li
            key={event.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
          >
            <div className="min-w-0">
              <p>
                <span className="font-medium">
                  {auditActorLabel(event, names)}
                </span>{" "}
                {event.sentence}
              </p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {formatArgentineDateTime(event.ts)}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelected({ kind: "event", ...event })}
            >
              <Eye />
              Ver detalle
            </Button>
          </li>
        ))}
      </ul>
      {data.length >= RECORD_HISTORY_LIMIT && (
        <p className="text-muted-foreground border-t px-4 py-2 text-xs">
          Se muestran los últimos {RECORD_HISTORY_LIMIT} eventos; el resto está
          en Admin › Auditoría.
        </p>
      )}
      <AuditDetailDialog
        item={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </>
  );
}
