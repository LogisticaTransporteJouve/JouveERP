"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";

import { useInvoiceStatusPoll } from "../hooks/use-invoices";
import { INVOICE_STATUS_LABEL, type InvoiceStatus } from "../schema";

const TERMINAL_STATES: InvoiceStatus[] = ["emitted", "failed", "cancelled"];

const TONE: Record<InvoiceStatus, string> = {
  draft: "bg-muted text-muted-foreground dark:text-muted-foreground",
  emitting: "bg-muted text-muted-foreground dark:text-muted-foreground",
  emitted: "bg-muted text-muted-foreground dark:text-muted-foreground",
  failed: "bg-muted text-foreground dark:text-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

export function InvoiceJobStatus({
  id,
  initialStatus,
}: {
  id: string;
  initialStatus: InvoiceStatus;
}) {
  const router = useRouter();
  const { data } = useInvoiceStatusPoll(id, initialStatus);
  const status = data?.status ?? initialStatus;

  // The detail page is server-rendered: once the emission settles, render it
  // again so the number, CAE and observaciones show up.
  useEffect(() => {
    if (status !== initialStatus && TERMINAL_STATES.includes(status)) {
      router.refresh();
    }
  }, [status, initialStatus, router]);

  return (
    <Badge variant="secondary" className={TONE[status]}>
      {INVOICE_STATUS_LABEL[status]}
      {!TERMINAL_STATES.includes(status) && (
        <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-current" />
      )}
    </Badge>
  );
}
