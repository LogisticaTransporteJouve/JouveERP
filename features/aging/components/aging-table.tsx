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

import { useAgingSummary } from "../hooks/use-aging";
import type { ClientAgingRow } from "../actions/aging-actions";
import { agingKeys } from "../lib/aging-keys";

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
  // adjust as soon as another user emits a comprobante or registers un
  // recibo con imputación.
  useRealtimeInvalidate([
    { table: "comprobantes", queryKeys: [agingKeys.all] },
    { table: "receipts", queryKeys: [agingKeys.all] },
  ]);

  return (
    <div className="space-y-4">
      <BucketSummary totals={totals} />
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead className="text-right">0–30 días</TableHead>
              <TableHead className="text-right">30–60</TableHead>
              <TableHead className="text-right">60–90</TableHead>
              <TableHead className="text-right">90+</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right w-24">Documentos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No hay clientes con saldo deudor.
                </TableCell>
              </TableRow>
            ) : (
              clients.map((c) => <AgingRow key={c.client_id} row={c} />)
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AgingRow({ row }: { row: ClientAgingRow }) {
  const isOld = row.bucket_60_90 > 0 || row.bucket_90_plus > 0;
  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/clientes/${row.client_id}`}
          className="font-medium hover:underline"
        >
          {row.legal_name}
        </Link>
        <p className="text-xs text-muted-foreground font-mono">
          CUIT {row.cuit}
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
