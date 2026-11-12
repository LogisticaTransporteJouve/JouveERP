"use client";

import {
  AgingReportView,
  type AgingReportCopy,
} from "@/components/aging-report-view";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { scopedHref } from "@/lib/scope";

import { useSupplierAging } from "../hooks/use-suppliers";
import { suppliersKeys } from "../lib/suppliers-keys";

const COPY: AgingReportCopy = {
  partyHeader: "Proveedor",
  partyPlural: "proveedores",
  totalLabel: "Total adeudado",
  emptyMessage: "No hay proveedores con deuda abierta.",
  buckets: {
    "0_30": {
      label: "0–30 días",
      header: "0–30 días",
      hint: "por pagar pronto",
    },
    "30_60": { label: "30–60 días", header: "30–60", hint: "vencido reciente" },
    "60_90": { label: "60–90 días", header: "60–90", hint: "alerta" },
    "90_plus": { label: "90+ días", header: "90+", hint: "atraso crítico" },
  },
};

/** `channelId`: one segregated channel's suppliers (its section's Resumen);
 *  their rows open in that section. */
export function SupplierAgingTable({
  channelId = null,
}: {
  channelId?: string | null;
}) {
  const { data } = useSupplierAging(channelId);
  const supplierHref = (id: string) =>
    scopedHref(`/suppliers/${id}`, channelId);

  useRealtimeInvalidate([
    { table: "purchase_invoices", queryKeys: [suppliersKeys.all] },
    { table: "payment_orders", queryKeys: [suppliersKeys.all] },
  ]);

  return <AgingReportView report={data} copy={COPY} partyHref={supplierHref} />;
}
