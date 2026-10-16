"use client";

import {
  AgingReportView,
  type AgingReportCopy,
} from "@/components/aging-report-view";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";

import { useAgingSummary } from "../hooks/use-aging";
import { agingKeys } from "../lib/aging-keys";

const COPY: AgingReportCopy = {
  partyHeader: "Cliente",
  partyPlural: "clientes",
  totalLabel: "Total deudor",
  emptyMessage: "No hay clientes con saldo deudor.",
  buckets: {
    "0_30": {
      label: "0–30 días",
      header: "0–30 días",
      hint: "al día / corriente",
    },
    "30_60": { label: "30–60 días", header: "30–60", hint: "atrasado" },
    "60_90": { label: "60–90 días", header: "60–90", hint: "alerta" },
    "90_plus": { label: "90+ días", header: "90+", hint: "incobrable" },
  },
};

const clientHref = (id: string) => `/clients/${id}`;

export function AgingTable() {
  const { data } = useAgingSummary();

  // Aging is derived from comprobantes (numerador / saldo) and receipts
  // (allocations). Subscribe to both so finance sees the bucket totals
  // adjust as soon as another user emits a comprobante or registers a
  // receipt with an allocation.
  useRealtimeInvalidate([
    { table: "invoices", queryKeys: [agingKeys.all] },
    { table: "receipts", queryKeys: [agingKeys.all] },
  ]);

  return <AgingReportView report={data} copy={COPY} partyHref={clientHref} />;
}
