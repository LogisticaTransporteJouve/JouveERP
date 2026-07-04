"use client";

import { useMemo } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { formatMoney } from "@/lib/format";

import { useSupplierAging } from "../hooks/use-suppliers";
import { suppliersKeys } from "../lib/suppliers-keys";
import type { SupplierAgingSummary } from "../actions/account-actions";

const fmtMoney = { format: (n: number) => formatMoney(n, "ARS") };

function MoneyCell({
  amount,
  highlight,
}: {
  amount: number;
  highlight?: boolean;
}) {
  if (amount <= 0) {
    return <span className="text-xs text-muted-foreground/60">—</span>;
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

export function SupplierAgingTable() {
  const { data: suppliers } = useSupplierAging();

  useRealtimeInvalidate([
    { table: "purchase_invoices", queryKeys: [suppliersKeys.all] },
    { table: "payment_orders", queryKeys: [suppliersKeys.all] },
  ]);

  const totals = suppliers.reduce(
    (acc, s) => ({
      bucket_0_30: acc.bucket_0_30 + s.bucket_0_30,
      bucket_30_60: acc.bucket_30_60 + s.bucket_30_60,
      bucket_60_90: acc.bucket_60_90 + s.bucket_60_90,
      bucket_90_plus: acc.bucket_90_plus + s.bucket_90_plus,
      total_open: acc.total_open + s.total_open,
      supplier_count: acc.supplier_count + 1,
      document_count: acc.document_count + s.document_count,
    }),
    {
      bucket_0_30: 0,
      bucket_30_60: 0,
      bucket_60_90: 0,
      bucket_90_plus: 0,
      total_open: 0,
      supplier_count: 0,
      document_count: 0,
    },
  );

  const columns = useMemo<ColumnDef<SupplierAgingSummary>[]>(
    () => [
      {
        accessorKey: "supplier_legal_name",
        header: "Proveedor",
        meta: { mobile: "primary" },
        cell: ({ row }) => (
          <>
            <Link
              href={`/suppliers/${row.original.supplier_id}`}
              className="font-medium hover:underline"
            >
              {row.original.supplier_legal_name}
            </Link>
            <p className="text-xs text-muted-foreground font-mono">
              CUIT {row.original.supplier_cuit}
            </p>
          </>
        ),
      },
      {
        accessorKey: "bucket_0_30",
        header: "0–30 días",
        meta: { align: "right", mobile: "secondary" },
        cell: ({ row }) => <MoneyCell amount={row.original.bucket_0_30} />,
      },
      {
        accessorKey: "bucket_30_60",
        header: "30–60",
        meta: { align: "right", mobile: "secondary" },
        cell: ({ row }) => <MoneyCell amount={row.original.bucket_30_60} />,
      },
      {
        accessorKey: "bucket_60_90",
        header: "60–90",
        meta: { align: "right", mobile: "secondary" },
        cell: ({ row }) => (
          <MoneyCell amount={row.original.bucket_60_90} highlight />
        ),
      },
      {
        accessorKey: "bucket_90_plus",
        header: "90+",
        meta: { align: "right", mobile: "primary" },
        cell: ({ row }) => (
          <MoneyCell amount={row.original.bucket_90_plus} highlight />
        ),
      },
      {
        accessorKey: "total_open",
        header: "Total",
        meta: { align: "right", mobile: "primary" },
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
      },
      {
        accessorKey: "document_count",
        header: "Documentos",
        meta: { align: "right", headerClassName: "w-24", mobile: "secondary" },
        cell: ({ row }) => (
          <Badge variant="secondary" className="font-mono">
            {row.original.document_count}
          </Badge>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <BucketSummary totals={totals} />
      <DataTable
        columns={columns}
        data={suppliers}
        getRowId={(s) => s.supplier_id}
        defaultSorting={[{ id: "total_open", desc: true }]}
        emptyMessage="No hay proveedores con deuda abierta."
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
    supplier_count: number;
    document_count: number;
  };
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <SummaryCard
        label="0–30 días"
        value={totals.bucket_0_30}
        hint="por pagar pronto"
      />
      <SummaryCard
        label="30–60 días"
        value={totals.bucket_30_60}
        hint="vencido reciente"
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
        hint="atraso crítico"
        tone="danger"
      />
      <SummaryCard
        label="Total adeudado"
        value={totals.total_open}
        hint={`${totals.supplier_count} proveedores · ${totals.document_count} documentos`}
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
        ? "text-muted-foreground dark:text-muted-foreground"
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
