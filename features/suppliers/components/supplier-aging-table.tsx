"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";

import { useSupplierAging } from "../hooks/use-suppliers";
import { suppliersKeys } from "../lib/suppliers-keys";
import type { SupplierAgingSummary } from "../actions/account-actions";

const fmtMoney = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

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

  return (
    <div className="space-y-4">
      <BucketSummary totals={totals} />
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Proveedor</TableHead>
              <TableHead className="text-right">0–30 días</TableHead>
              <TableHead className="text-right">30–60</TableHead>
              <TableHead className="text-right">60–90</TableHead>
              <TableHead className="text-right">90+</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right w-24">Documentos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No hay proveedores con deuda abierta.
                </TableCell>
              </TableRow>
            ) : (
              suppliers
                .slice()
                .sort((a, b) => b.total_open - a.total_open)
                .map((s) => <AgingRow key={s.supplier_id} row={s} />)
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AgingRow({ row }: { row: SupplierAgingSummary }) {
  const isOld = row.bucket_60_90 > 0 || row.bucket_90_plus > 0;
  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/suppliers/${row.supplier_id}`}
          className="font-medium hover:underline"
        >
          {row.supplier_legal_name}
        </Link>
        <p className="text-xs text-muted-foreground font-mono">
          CUIT {row.supplier_cuit}
        </p>
      </TableCell>
      <TableCell className="text-right">
        <MoneyCell amount={row.bucket_0_30} />
      </TableCell>
      <TableCell className="text-right">
        <MoneyCell amount={row.bucket_30_60} />
      </TableCell>
      <TableCell className="text-right">
        <MoneyCell amount={row.bucket_60_90} highlight />
      </TableCell>
      <TableCell className="text-right">
        <MoneyCell amount={row.bucket_90_plus} highlight />
      </TableCell>
      <TableCell className="text-right">
        <span
          className={
            isOld
              ? "font-mono text-sm font-semibold text-destructive"
              : "font-mono text-sm font-medium"
          }
        >
          {fmtMoney.format(row.total_open)}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <Badge variant="secondary" className="font-mono">
          {row.document_count}
        </Badge>
      </TableCell>
    </TableRow>
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
