"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";

import { COMPROBANTE_STATUS_LABEL, type ComprobanteStatus } from "../schema";

const POLL_MS = 1500;
const TERMINAL_STATES: ComprobanteStatus[] = ["emitted", "failed", "cancelled"];

const TONE: Record<ComprobanteStatus, string> = {
  draft: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  emitting: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  emitted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-500/15 text-red-700 dark:text-red-300",
  cancelled: "bg-muted text-muted-foreground",
};

export function InvoiceJobStatus({
  id,
  initialStatus,
}: {
  id: string;
  initialStatus: ComprobanteStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ComprobanteStatus>(initialStatus);
  const lastSeenRef = useRef<ComprobanteStatus>(initialStatus);

  useEffect(() => {
    if (TERMINAL_STATES.includes(status)) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { status: ComprobanteStatus };
        if (cancelled) return;
        if (json.status !== lastSeenRef.current) {
          lastSeenRef.current = json.status;
          setStatus(json.status);
          if (TERMINAL_STATES.includes(json.status)) {
            // Final transition — refresh the server component to pick up
            // CAE, pdf_url and any observaciones.
            router.refresh();
          }
        }
      } catch {
        // swallow — next tick retries
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, status, router]);

  return (
    <Badge variant="secondary" className={TONE[status]}>
      {COMPROBANTE_STATUS_LABEL[status]}
      {!TERMINAL_STATES.includes(status) && (
        <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-current" />
      )}
    </Badge>
  );
}
