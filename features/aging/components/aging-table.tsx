"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { formatMoney } from "@/lib/format";

import { useAgingSummary } from "../hooks/use-aging";
import { agingKeys } from "../lib/aging-keys";
import type { ClientAgingRow } from "../schema";

const fmtMoney = { format: (n: number) => formatMoney(n, "ARS") };

function MoneyCell({
  amount,
  highlight,
}: {
  amount: number;
  highlight?: boolean;
}) {
  if (amount <= 0) {
    return (
      <span className="text-xs text-muted-foreground/60">—</span>
    );
  }
  return (
    <span
      className={
        highlight
          ? "font-mono text-sm font-semibold text-destructive"
          : "font-mono text-sm"
      }
    >
      {fmtMoney.format(amount)}
    </span>
  );
}

export function AgingTable() {
  const { data } = useAgingSummary();
  const { clients, totals } = data;

  // Aging is derived from comprobantes (numerador / saldo) and receipts
  // (allocations). Subscribe to both so finance sees the bucket totals
  // adjust as soon as another user emits a comprobante or registers a
  // receipt with an allocation.
  useRealtimeInvalidate([
    { table: "invoices", queryKeys: [agingKeys.all] },
    { table: "receipts", queryKeys: [agingKeys.all] },
  ]);

  const columns = useMemo<ColumnDef<ClientAgingRow>[]>(
    () => [
      {
        accessorKey: "legal_name",
        header: "Cliente",
        meta: { mobile: "primary" },
        cell: ({ row }) => (
          <>
            <Link
              href={`/clients/${row.original.client_id}`}
              className="font-medium hover:underline"
            >
              {row.original.legal_name}
            </Link>
            <p className="text-xs text-muted-foreground font-mono">
              CUIT {row.original.cuit}
            </p>
          </>
        ),
      },
      {
        accessorKey: "bucket_0_30",
        header: "0–30 días",
        cell: ({ row }) => <MoneyCell amount={row.original.bucket_0_30} />,
        meta: { align: "right", mobile: "secondary" },
      },
      {
        accessorKey: "bucket_30_60",
        header: "30–60",
        cell: ({ row }) => <MoneyCell amount={row.original.bucket_30_60} />,
        meta: { align: "right", mobile: "secondary" },
      },
      {
        accessorKey: "bucket_60_90",
        header: "60–90",
        cell: ({ row }) => (
          <MoneyCell amount={row.original.bucket_60_90} highlight />
        ),
        meta: { align: "right", mobile: "secondary" },
      },
      {
        accessorKey: "bucket_90_plus",
        header: "90+",
        cell: ({ row }) => (
          <MoneyCell amount={row.original.bucket_90_plus} highlight />
        ),
        meta: { align: "right", mobile: "primary" },
      },
      {
        accessorKey: "total_open",
        header: "Total",
        cell: ({ row }) => {
          const isOld =
            row.original.bucket_60_90 > 0 || row.original.bucket_90_plus > 0;
          return (
            <span
              className={
                isOld
                  ? "font-mono text-sm font-semibold text-destructive"
                  : "font-mono text-sm font-medium"
              }
            >
              {fmtMoney.format(row.original.total_open)}
            </span>
          );
        },
        meta: { align: "right", mobile: "primary" },
      },
      {
        accessorKey: "document_count",
        header: "Documentos",
        cell: ({ row }) => (
          <Badge variant="secondary" className="font-mono">
            {row.original.document_count}
          </Badge>
        ),
        meta: { align: "right", headerClassName: "w-24", mobile: "secondary" },
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <BucketSummary totals={totals} />
      <DataTable
        columns={columns}
        data={clients}
        getRowId={(c) => c.client_id}
        emptyMessage="No hay clientes con saldo deudor."
      />
    </div>
  );
}

function BucketSummary({
  totals,
}: {
  totals: {
    bucket_0_30: number;
    bucket_30_60: number;
    bucket_60_90: number;
    bucket_90_plus: number;
    total_open: number;
    client_count: number;
    document_count: number;
  };
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <SummaryCard
        label="0–30 días"
        value={totals.bucket_0_30}
        hint="al día / corriente"
      />
      <SummaryCard
        label="30–60 días"
        value={totals.bucket_30_60}
        hint="atrasado"
      />
      <SummaryCard
        label="60–90 días"
        value={totals.bucket_60_90}
        hint="alerta"
        tone="warn"
      />
      <SummaryCard
        label="90+ días"
        value={totals.bucket_90_plus}
        hint="incobrable"
        tone="danger"
      />
      <SummaryCard
        label="Total deudor"
        value={totals.total_open}
        hint={`${totals.client_count} clientes · ${totals.document_count} documentos`}
        emphasized
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone,
  emphasized,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "warn" | "danger";
  emphasized?: boolean;
}) {
  const valueClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-500"
        : emphasized
          ? "text-foreground"
          : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold ${valueClass}`}>
        {fmtMoney.format(value)}
      </p>
      {hint && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
