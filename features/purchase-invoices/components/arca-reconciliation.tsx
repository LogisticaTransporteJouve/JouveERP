"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, Suspense, useMemo, useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { purchaseOwnTipoLabel } from "@/lib/afip/codes";
import {
  formatArgentineDate,
  formatMoney,
  formatMoneySigned,
  formatPeriod,
} from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  useArcaReconciliationDetail,
  useArcaReconciliationMonths,
} from "../hooks/use-arca-reconciliation";
import {
  groupByYear,
  periodReconciled,
  sideDiff,
  type ReconciliationIssue,
  type ReconciliationIssueKind,
  type ReconciliationPeriod,
  type SideTotals,
} from "../lib/arca-reconciliation";
import { RECEIVED_VOUCHER_TAB_LABEL, formatInvoiceNumber } from "../schema";

const nf = new Intl.NumberFormat("es-AR");

const AMOUNTS = [
  { key: "neto", label: "Neto gravado" },
  { key: "iva", label: "IVA" },
  { key: "trib", label: "Otros tributos" },
  { key: "total", label: "Total" },
] as const satisfies readonly { key: keyof SideTotals; label: string }[];

function periodLabel(period: string): string {
  return period.length === 4 ? period : formatPeriod(period);
}

export function ArcaReconciliation() {
  const { data: months } = useArcaReconciliationMonths();
  const years = useMemo(() => groupByYear(months), [months]);
  const latest = years[0]?.period ?? null;
  const [selected, setSelected] = useState<string | null>(latest);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(latest ? [latest] : []),
  );

  const first = years[0];
  if (!first) {
    return (
      <p className="rounded-lg border px-4 py-6 text-sm text-muted-foreground">
        Todavía no hay comprobantes de ARCA ni compras fiscales para conciliar.
        Traé los recibidos desde{" "}
        <Link href="/purchases/arca" className="underline underline-offset-4">
          Recibidos de ARCA
        </Link>
        .
      </p>
    );
  }

  const period = selected ?? first.period;
  const all = years.flatMap((y) => [y, ...y.months]);
  const current = all.find((p) => p.period === period) ?? first;

  function toggle(year: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  return (
    <div className="space-y-8">
      <Section
        title="Por período"
        description="Importes en pesos: los de dólares, a la cotización de cada comprobante; las notas de crédito restan. No cuentan los comprobantes descartados de la bandeja ni las compras anuladas o de otras compras. Elegí un año o un mes para ver sus comprobantes."
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Período</th>
                <th className="px-4 py-2 text-left font-medium">Origen</th>
                <th className="px-4 py-2 text-right font-medium">Cantidad</th>
                {AMOUNTS.map((a) => (
                  <th key={a.key} className="px-4 py-2 text-right font-medium">
                    {a.label}
                  </th>
                ))}
              </tr>
            </thead>
            {years.map((y) => (
              <Fragment key={y.period}>
                <PeriodRows
                  row={y}
                  selected={period === y.period}
                  onSelect={() => setSelected(y.period)}
                  expanded={expanded.has(y.period)}
                  onToggle={() => toggle(y.period)}
                />
                {expanded.has(y.period) &&
                  y.months.map((m) => (
                    <PeriodRows
                      key={m.period}
                      row={m}
                      selected={period === m.period}
                      onSelect={() => setSelected(m.period)}
                    />
                  ))}
              </Fragment>
            ))}
          </table>
        </div>
      </Section>

      <Suspense
        key={period}
        fallback={<Skeleton className="h-48 w-full rounded-lg" />}
      >
        <PeriodDetail period={current} />
      </Suspense>
    </div>
  );
}

function PeriodRows({
  row,
  selected,
  onSelect,
  expanded,
  onToggle,
}: {
  row: ReconciliationPeriod;
  selected: boolean;
  onSelect: () => void;
  /** Only a year: whether its months show. */
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const isYear = onToggle !== undefined;
  const countDiff = row.arca.count - row.erp.count;
  return (
    <tbody
      className={cn(
        "border-b last:border-b-0",
        selected ? "bg-muted/60" : "hover:bg-muted/30",
      )}
    >
      <tr>
        <td rowSpan={3} className="px-4 py-2 align-top">
          <div className="flex items-center gap-1">
            {isYear ? (
              <IconButton
                label={expanded ? "Ocultar meses" : "Ver meses"}
                variant="ghost"
                size="icon-xs"
                onClick={onToggle}
                aria-expanded={expanded}
                className="text-muted-foreground"
              >
                {expanded ? <ChevronDown /> : <ChevronRight />}
              </IconButton>
            ) : (
              <span className="size-6 shrink-0" aria-hidden />
            )}
            <button
              type="button"
              onClick={onSelect}
              aria-pressed={selected}
              className={cn(
                "text-left capitalize underline-offset-4 hover:underline",
                isYear ? "font-semibold" : undefined,
                selected ? "font-semibold" : undefined,
              )}
            >
              {periodLabel(row.period)}
            </button>
          </div>
          <p className="mt-1 pl-7 text-xs text-muted-foreground">
            {periodReconciled(row) ? "Conciliado" : "Con diferencias"}
          </p>
        </td>
        <td className="px-4 py-1 text-muted-foreground">ARCA</td>
        <td className="px-4 py-1 text-right font-mono tabular-nums">
          {nf.format(row.arca.count)}
        </td>
        {AMOUNTS.map((a) => (
          <td
            key={a.key}
            className="px-4 py-1 text-right font-mono tabular-nums"
          >
            {formatMoneySigned(row.arca[a.key])}
          </td>
        ))}
      </tr>
      <tr>
        <td className="px-4 py-1 text-muted-foreground">ERP</td>
        <td className="px-4 py-1 text-right font-mono tabular-nums">
          {nf.format(row.erp.count)}
        </td>
        {AMOUNTS.map((a) => (
          <td
            key={a.key}
            className="px-4 py-1 text-right font-mono tabular-nums"
          >
            {formatMoneySigned(row.erp[a.key])}
          </td>
        ))}
      </tr>
      <tr>
        <td className="px-4 py-1 pb-2 text-muted-foreground">Diferencia</td>
        <DiffCell value={countDiff === 0 ? null : countDiff} count />
        {AMOUNTS.map((a) => (
          <DiffCell
            key={a.key}
            value={sideDiff(row.arca[a.key], row.erp[a.key])}
          />
        ))}
      </tr>
    </tbody>
  );
}

function DiffCell({ value, count }: { value: number | null; count?: boolean }) {
  if (value === null) {
    return (
      <td className="px-4 py-1 pb-2 text-right font-mono text-muted-foreground">
        —
      </td>
    );
  }
  const text = count
    ? `${value > 0 ? "+" : ""}${nf.format(value)}`
    : `${value > 0 ? "+" : ""}${formatMoneySigned(value)}`;
  return (
    <td className="px-4 py-1 pb-2 text-right font-mono font-semibold tabular-nums">
      {text}
    </td>
  );
}

const ISSUE_SECTIONS: readonly {
  issue: ReconciliationIssueKind;
  title: string;
  description: string;
  empty: string;
}[] = [
  {
    issue: "arca_only",
    title: "En ARCA y no en el ERP",
    description:
      "ARCA los lista como recibidos y no hay una compra fiscal con el mismo proveedor (CUIT), tipo, letra, punto de venta y número.",
    empty: "Todos los comprobantes de ARCA están cargados como compra.",
  },
  {
    issue: "erp_only",
    title: "En el ERP y no en ARCA",
    description:
      "Compras fiscales que no aparecen en lo que ARCA lista como recibido (o cuyo comprobante se descartó en la bandeja).",
    empty: "Todas las compras fiscales aparecen en ARCA.",
  },
  {
    issue: "amount_mismatch",
    title: "Con importes distintos",
    description:
      "Están en los dos lados pero el total difiere en más de $ 0,01.",
    empty: "Los comprobantes que están en los dos lados tienen el mismo total.",
  },
];

function PeriodDetail({ period }: { period: ReconciliationPeriod }) {
  const { data } = useArcaReconciliationDetail(period.period);
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h2 className="text-base font-semibold capitalize">
          {periodLabel(period.period)}
        </h2>
        {period.uncomparable > 0 && (
          <p className="text-xs text-muted-foreground">
            {nf.format(period.uncomparable)}{" "}
            {period.uncomparable === 1
              ? "comprobante de ARCA cuenta en la cantidad pero no en los importes: no se pudieron leer sus importes o es de un tipo que no se carga solo."
              : "comprobantes de ARCA cuentan en la cantidad pero no en los importes: no se pudieron leer sus importes o son de un tipo que no se carga solo."}
          </p>
        )}
      </div>
      {ISSUE_SECTIONS.map((s) => (
        <IssueSection
          key={s.issue}
          title={s.title}
          description={s.description}
          empty={s.empty}
          issue={s.issue}
          rows={data[s.issue].rows}
          count={data[s.issue].count}
        />
      ))}
    </div>
  );
}

function voucherLabel(r: ReconciliationIssue): string {
  const own = r.cbte_tipo !== null ? purchaseOwnTipoLabel(r.cbte_tipo) : null;
  const number = { punto_venta: r.punto_venta, numero: r.numero };
  if (own) return `${own} ${formatInvoiceNumber({ letter: "", ...number })}`;
  if (r.kind) {
    return formatInvoiceNumber({ kind: r.kind, letter: r.letter, ...number });
  }
  return `Tipo ${r.cbte_tipo ?? "?"} · ${formatInvoiceNumber({ letter: "", ...number })}`;
}

function money(value: number | null, moneda: string | null): string {
  if (value === null) return "—";
  return formatMoney(value, moneda === "DOL" ? "USD" : "ARS");
}

function IssueSection({
  title,
  description,
  empty,
  issue,
  rows,
  count,
}: {
  title: string;
  description: string;
  empty: string;
  issue: ReconciliationIssueKind;
  rows: ReconciliationIssue[];
  count: number;
}) {
  return (
    <Section
      title={`${title}${count > 0 ? ` (${nf.format(count)})` : ""}`}
      description={description}
    >
      {rows.length === 0 ? (
        <p className="rounded-lg border px-4 py-4 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Fecha</th>
                <th className="px-4 py-2 text-left font-medium">Proveedor</th>
                <th className="px-4 py-2 text-left font-medium">Comprobante</th>
                {issue !== "erp_only" && (
                  <th className="px-4 py-2 text-right font-medium">
                    Total ARCA
                  </th>
                )}
                {issue !== "arca_only" && (
                  <th className="px-4 py-2 text-right font-medium">
                    Total ERP
                  </th>
                )}
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr
                  key={`${r.voucher_id ?? ""}-${r.purchase_invoice_id ?? ""}`}
                >
                  <td className="px-4 py-2 whitespace-nowrap">
                    {formatArgentineDate(r.fecha)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="max-w-[16rem] min-w-0">
                      <p className="truncate" title={r.issuer_name ?? ""}>
                        {r.issuer_name ?? "—"}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {r.issuer_cuit ?? "—"}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-2 font-mono whitespace-nowrap">
                    {voucherLabel(r)}
                  </td>
                  {issue !== "erp_only" && (
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap tabular-nums">
                      {money(r.arca_total, r.arca_moneda)}
                    </td>
                  )}
                  {issue !== "arca_only" && (
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap tabular-nums">
                      {money(r.erp_total, r.erp_moneda)}
                    </td>
                  )}
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <IssueLink row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {count > rows.length && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              Se muestran los {nf.format(rows.length)} más recientes de{" "}
              {nf.format(count)}. Elegí un mes para ver menos a la vez.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

function IssueLink({ row }: { row: ReconciliationIssue }) {
  const className = "text-sm underline underline-offset-4";
  if (row.purchase_invoice_id) {
    return (
      <Link
        href={`/purchases/${row.purchase_invoice_id}`}
        className={className}
      >
        Ver compra
      </Link>
    );
  }
  if (row.voucher_status) {
    return (
      <Link
        href={`/purchases/arca?estado=${row.voucher_status}`}
        className={className}
        title={`Bandeja › ${RECEIVED_VOUCHER_TAB_LABEL[row.voucher_status]}`}
      >
        Ver en la bandeja
      </Link>
    );
  }
  return null;
}
