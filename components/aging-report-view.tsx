"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  AGING_BUCKETS,
  isAgingOverdue,
  type AgingBucket,
  type AgingPartyRow,
  type AgingReport,
  type CurrencyAmounts,
} from "@/lib/aging";
import { formatArgentineDate, formatMoney } from "@/lib/format";

// Shared view for the client and supplier aging pages: per-currency buckets
// (pesos and dollars never summed) plus a single ARS-equivalent total at the
// latest official rate.

type BucketCopy = { label: string; header: string; hint: string };

export type AgingReportCopy = {
  partyHeader: string;
  partyPlural: string;
  totalLabel: string;
  emptyMessage: string;
  buckets: Record<AgingBucket, BucketCopy>;
};

const LATE: ReadonlySet<AgingBucket> = new Set(["60_90", "90_plus"]);

function AmountsCell({
  amounts,
  highlight,
}: {
  amounts: CurrencyAmounts;
  highlight?: boolean;
}) {
  if (amounts.ars <= 0 && amounts.usd <= 0) {
    return <span className="text-xs text-muted-foreground/60">—</span>;
  }
  const cls = highlight
    ? "font-mono text-sm font-semibold text-destructive"
    : "font-mono text-sm";
  return (
    <span className="inline-flex flex-col items-end">
      {amounts.ars > 0 && (
        <span className={cls}>{formatMoney(amounts.ars)}</span>
      )}
      {amounts.usd > 0 && (
        <span className={cls}>{formatMoney(amounts.usd, "USD")}</span>
      )}
    </span>
  );
}

export function AgingReportView({
  report,
  copy,
  partyHref,
}: {
  report: AgingReport;
  copy: AgingReportCopy;
  partyHref: (id: string) => string;
}) {
  const { rows, totals, usd_rate } = report;

  const columns = useMemo<ColumnDef<AgingPartyRow>[]>(
    () => [
      {
        accessorKey: "legal_name",
        header: copy.partyHeader,
        meta: { mobile: "primary" },
        cell: ({ row }) => (
          <>
            <Link
              href={partyHref(row.original.id)}
              className="font-medium hover:underline"
            >
              {row.original.legal_name}
            </Link>
            <p className="font-mono text-xs text-muted-foreground">
              CUIT {row.original.cuit}
            </p>
          </>
        ),
      },
      ...AGING_BUCKETS.map((bucket): ColumnDef<AgingPartyRow> => ({
        id: `bucket_${bucket}`,
        header: copy.buckets[bucket].header,
        meta: {
          align: "right",
          mobile: bucket === "90_plus" ? "primary" : "secondary",
        },
        cell: ({ row }) => (
          <AmountsCell
            amounts={row.original.buckets[bucket]}
            highlight={LATE.has(bucket)}
          />
        ),
      })),
      {
        id: "total",
        header: "Total",
        accessorFn: (r) => r.total_ars_equivalent ?? r.total.ars,
        meta: { align: "right", mobile: "primary" },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="inline-flex flex-col items-end">
              <AmountsCell amounts={r.total} highlight={isAgingOverdue(r)} />
              {r.total.usd > 0 && r.total_ars_equivalent !== null && (
                <span className="font-mono text-xs text-muted-foreground">
                  ≈ {formatMoney(r.total_ars_equivalent)}
                </span>
              )}
            </span>
          );
        },
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
    [copy, partyHref],
  );

  const hasUsd = totals.total.usd > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {AGING_BUCKETS.map((bucket) => (
          <SummaryCard
            key={bucket}
            label={copy.buckets[bucket].label}
            amounts={totals.buckets[bucket]}
            showUsd={hasUsd}
            hint={copy.buckets[bucket].hint}
            tone={
              bucket === "90_plus"
                ? "danger"
                : bucket === "60_90"
                  ? "warn"
                  : undefined
            }
          />
        ))}
        <SummaryCard
          label={copy.totalLabel}
          amounts={totals.total}
          showUsd={hasUsd}
          hint={`${totals.party_count} ${copy.partyPlural} · ${totals.document_count} documentos`}
          equivalent={
            hasUsd
              ? totals.total_ars_equivalent !== null && usd_rate
                ? `≈ ${formatMoney(totals.total_ars_equivalent)} al dólar oficial ${formatMoney(
                    usd_rate.rate,
                  )} (${formatArgentineDate(usd_rate.rate_date)})`
                : "Sin cotización del dólar cargada: no se puede consolidar en pesos."
              : undefined
          }
        />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        emptyMessage={copy.emptyMessage}
      />
    </div>
  );
}

function SummaryCard({
  label,
  amounts,
  showUsd,
  hint,
  tone,
  equivalent,
}: {
  label: string;
  amounts: CurrencyAmounts;
  showUsd: boolean;
  hint: string;
  tone?: "warn" | "danger";
  equivalent?: string;
}) {
  const valueClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warn"
        ? "text-muted-foreground"
        : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold ${valueClass}`}>
        {formatMoney(amounts.ars)}
      </p>
      {showUsd && (
        <p className={`font-mono text-sm font-semibold ${valueClass}`}>
          {formatMoney(amounts.usd, "USD")}
        </p>
      )}
      {equivalent && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{equivalent}</p>
      )}
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
