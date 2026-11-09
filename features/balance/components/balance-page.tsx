"use client";

import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { Suspense, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterField } from "@/components/ui/filter-field";
import { MonthPicker } from "@/components/ui/month-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fiscalYearPresets } from "@/lib/fiscal-year";
import { formatNumber2 } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useAccountBalances } from "../hooks/use-balance";
import {
  balanceRangeHint,
  computeBalanceSheetEquity,
  computeBalanceTotals,
  computeEERR,
  currentMonth,
  groupByType,
  resultsStart,
  type AccountBalanceRow,
} from "../schema";

const money = (n: number) => formatNumber2(Math.abs(n));
const signed = (n: number) => (n >= 0 ? money(n) : `-${money(n)}`);

export function BalancePage({
  fiscalYearStartMonth,
}: {
  fiscalYearStartMonth: number;
}) {
  const [periodEnd, setPeriodEnd] = useState(currentMonth());
  const [periodStart, setPeriodStart] = useState("");
  const costCenterId = null;
  const presets = fiscalYearPresets(currentMonth(), fiscalYearStartMonth);

  function applyPreset(range: { from: string; to: string }) {
    setPeriodStart(range.from);
    setPeriodEnd(range.to);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Balance</h1>
        <p className="text-sm text-muted-foreground">
          Saldos contables hasta el cierre del período seleccionado.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <FilterField id="balance-period-end" label="Período de corte">
          <MonthPicker
            id="balance-period-end"
            value={periodEnd}
            onChange={(value) => setPeriodEnd(value || currentMonth())}
            className="w-[180px]"
          />
        </FilterField>
        <FilterField id="balance-period-start" label="Desde (opcional)">
          <MonthPicker
            id="balance-period-start"
            value={periodStart}
            max={periodEnd}
            onChange={setPeriodStart}
            className="w-[180px]"
            clearable
          />
        </FilterField>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => applyPreset(presets.current)}
          >
            Ejercicio actual
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => applyPreset(presets.previous)}
          >
            Ejercicio anterior
          </Button>
          {periodStart && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPeriodStart("")}
            >
              Limpiar rango
            </Button>
          )}
        </div>
        <p className="text-muted-foreground w-full text-xs">
          {balanceRangeHint(
            periodEnd,
            periodStart || null,
            fiscalYearStartMonth,
          )}
        </p>
      </div>

      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <BalanceTabs
          periodEnd={periodEnd}
          periodStart={periodStart || null}
          costCenterId={costCenterId}
          resultsFrom={resultsStart(
            periodEnd,
            periodStart || null,
            fiscalYearStartMonth,
          )}
        />
      </Suspense>
    </div>
  );
}

function BalanceTabs({
  periodEnd,
  periodStart,
  costCenterId,
  resultsFrom,
}: {
  periodEnd: string;
  periodStart: string | null;
  costCenterId: string | null;
  /** First month of the results: «Desde», else the ejercicio's start. */
  resultsFrom: string;
}) {
  const { data: rows } = useAccountBalances(
    periodEnd,
    periodStart,
    costCenterId,
  );
  const { data: resultRows } = useAccountBalances(
    periodEnd,
    resultsFrom,
    costCenterId,
  );

  return (
    <Tabs defaultValue="saldos">
      <TabsList>
        <TabsTrigger value="saldos">Balance de saldos</TabsTrigger>
        <TabsTrigger value="eerr">Estado de Resultados</TabsTrigger>
        <TabsTrigger value="bg">Balance General</TabsTrigger>
      </TabsList>
      <TabsContent value="saldos" className="mt-4">
        <SaldosTab rows={rows} />
      </TabsContent>
      <TabsContent value="eerr" className="mt-4">
        <EERRTab rows={resultRows} />
      </TabsContent>
      <TabsContent value="bg" className="mt-4">
        <BGTab
          periodEnd={periodEnd}
          periodRows={resultRows}
          costCenterId={costCenterId}
        />
      </TabsContent>
    </Tabs>
  );
}

function SaldosTab({ rows }: { rows: AccountBalanceRow[] }) {
  const totals = useMemo(() => computeBalanceTotals(rows), [rows]);
  return (
    <div className="space-y-4">
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border p-3 text-sm",
          totals.isBalanced
            ? "border-border bg-muted"
            : "border-border bg-muted",
        )}
      >
        {totals.isBalanced ? (
          <CheckCircle2 className="size-4 text-muted-foreground" />
        ) : (
          <AlertTriangle className="size-4 text-foreground" />
        )}
        <span>
          {totals.isBalanced ? "Balance balanceado" : "Balance DESBALANCEADO"}:
          Σ Debe {money(totals.totalDebit)} · Σ Haber{" "}
          {money(totals.totalCredit)}
          {!totals.isBalanced && (
            <span className="ml-2 text-foreground">
              (diferencia{" "}
              {money(Math.abs(totals.totalDebit - totals.totalCredit))})
            </span>
          )}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-left text-xs">
            <tr>
              <th className="sticky left-0 z-10 w-24 bg-card px-3 py-2 font-medium">
                Código
              </th>
              <th className="px-3 py-2 font-medium">Cuenta</th>
              <th className="w-32 px-3 py-2 text-right font-medium">Debe</th>
              <th className="w-32 px-3 py-2 text-right font-medium">Haber</th>
              <th className="w-32 px-3 py-2 text-right font-medium">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-12 text-center text-sm text-muted-foreground"
                >
                  Sin movimientos hasta el período de corte.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.account_id}
                  className="group border-b last:border-b-0 hover:bg-muted/20"
                >
                  <td className="sticky left-0 z-10 bg-card px-3 py-1 font-mono text-xs group-hover:bg-muted/20">
                    {r.account_code}
                  </td>
                  <td className="px-3 py-1">{r.account_name}</td>
                  <td className="px-3 py-1 text-right font-mono">
                    {Number(r.total_debit) > 0
                      ? money(Number(r.total_debit))
                      : ""}
                  </td>
                  <td className="px-3 py-1 text-right font-mono">
                    {Number(r.total_credit) > 0
                      ? money(Number(r.total_credit))
                      : ""}
                  </td>
                  <td className="px-3 py-1 text-right font-mono font-medium">
                    {signed(Number(r.balance))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="border-t-2 bg-muted/30 font-semibold">
            <tr>
              <td
                colSpan={2}
                className="sticky left-0 z-10 bg-card px-3 py-2 text-right text-xs"
              >
                Totales
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {money(totals.totalDebit)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {money(totals.totalCredit)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function EERRTab({ rows }: { rows: AccountBalanceRow[] }) {
  const eerr = useMemo(() => computeEERR(rows), [rows]);
  return (
    <div className="divide-y rounded-lg border bg-card text-sm">
      {eerr.steps.map((step) =>
        step.kind === "subtotal" ? (
          <div
            key={step.label}
            className="flex items-center justify-between bg-muted/30 px-4 py-2 font-semibold"
          >
            <span>{step.label}</span>
            <span className="font-mono">{signed(step.total)}</span>
          </div>
        ) : (
          <details key={step.key} className="group px-4 py-2">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
                {step.label}
              </span>
              <span className="font-mono">{signed(step.total)}</span>
            </summary>
            {step.rows.length === 0 ? (
              <p className="mt-2 pl-5 text-xs text-muted-foreground">
                Sin movimientos en el período.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 pl-5 text-xs">
                {step.rows.map(({ row, amount }) => (
                  <li
                    key={row.account_id}
                    className="flex justify-between gap-3 text-muted-foreground"
                  >
                    <span className="min-w-0">
                      <span className="mr-2 font-mono">{row.account_code}</span>
                      {row.account_name}
                    </span>
                    <span className="font-mono">{signed(amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        ),
      )}
      <div className="flex items-center justify-between px-4 py-3 text-base font-semibold">
        <span className="flex items-center gap-2">
          Resultado del período
          <Badge variant="outline">
            {eerr.resultado >= 0 ? "Ganancia" : "Pérdida"}
          </Badge>
        </span>
        <span className="font-mono">{signed(eerr.resultado)}</span>
      </div>
    </div>
  );
}

function BGTab({
  periodEnd,
  periodRows,
  costCenterId,
}: {
  periodEnd: string;
  periodRows: AccountBalanceRow[];
  costCenterId: string | null;
}) {
  // A balance sheet is cumulative to the cut-off whatever "Desde" says; the
  // period's rows (from "Desde", else the ejercicio's start) only split results.
  const { data: rows } = useAccountBalances(periodEnd, null, costCenterId);
  const grouped = useMemo(() => groupByType(rows), [rows]);

  const activo = grouped.find((g) => g.type === "activo");
  const pasivo = grouped.find((g) => g.type === "pasivo");
  const patrimonio = grouped.find((g) => g.type === "patrimonio");

  const { resultadoPeriodo, resultadosAnteriores, totalPatrimonio } = useMemo(
    () => computeBalanceSheetEquity(rows, periodRows),
    [rows, periodRows],
  );
  const totalActivo = activo ? activo.total : 0;
  const totalPasivo = pasivo ? -pasivo.total : 0;
  const sumaPN = totalPasivo + totalPatrimonio;
  const cuadra = Math.abs(totalActivo - sumaPN) < 0.01;

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="space-y-4">
        {activo && (
          <TypeBlock label="Activo" rows={activo.rows} total={totalActivo} />
        )}
      </div>
      <div className="space-y-4">
        {pasivo && (
          <TypeBlock label="Pasivo" rows={pasivo.rows} total={totalPasivo} />
        )}
        <TypeBlock
          label="Patrimonio neto"
          rows={patrimonio?.rows ?? []}
          total={totalPatrimonio}
          extraRows={[
            {
              label: "Resultados de períodos anteriores",
              amount: resultadosAnteriores,
            },
            { label: "Resultado del período", amount: resultadoPeriodo },
          ]}
        />
        <div
          className={cn(
            "rounded-lg border p-3 text-sm font-semibold",
            cuadra ? "border-border bg-muted" : "border-border bg-muted",
          )}
        >
          Total Pasivo + PN = {signed(sumaPN)} {cuadra ? "✓" : "✗"}
        </div>
      </div>
    </div>
  );
}

function TypeBlock({
  label,
  rows,
  total,
  extraRows = [],
}: {
  label: string;
  rows: AccountBalanceRow[];
  total: number;
  extraRows?: { label: string; amount: number }[];
}) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="font-mono font-medium">{signed(total)}</span>
      </div>
      <ul className="divide-y text-sm">
        {rows.map((r) => {
          const sign =
            r.account_type === "pasivo" || r.account_type === "patrimonio"
              ? -1
              : 1;
          return (
            <li
              key={r.account_id}
              className="flex justify-between px-4 py-1.5 text-xs"
            >
              <span>
                <span className="mr-2 font-mono text-muted-foreground">
                  {r.account_code}
                </span>
                {r.account_name}
              </span>
              <span className="font-mono">
                {signed(Number(r.balance) * sign)}
              </span>
            </li>
          );
        })}
        {extraRows.map((extra) => (
          <li
            key={extra.label}
            className="flex justify-between bg-muted/20 px-4 py-1.5 text-xs italic"
          >
            <span>{extra.label}</span>
            <span className="font-mono">{signed(extra.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
