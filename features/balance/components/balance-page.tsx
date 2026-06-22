"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Suspense, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { formatNumber2 } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useAccountBalances } from "../hooks/use-balance";
import {
  computeBalanceTotals,
  computeEERR,
  currentMonth,
  groupByType,
  type AccountBalanceRow,
} from "../schema";

const money = (n: number) => formatNumber2(Math.abs(n));
const signed = (n: number) => (n >= 0 ? money(n) : `-${money(n)}`);

export function BalancePage() {
  const [periodEnd, setPeriodEnd] = useState(currentMonth());
  const [periodStart, setPeriodStart] = useState("");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Balance</h1>
        <p className="text-sm text-muted-foreground">
          Saldos contables hasta el cierre del período seleccionado.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Período de corte</label>
          <Input
            type="month"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value || currentMonth())}
            className="w-[180px]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            Desde (opcional)
          </label>
          <Input
            type="month"
            value={periodStart}
            max={periodEnd}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="w-[180px]"
          />
        </div>
        {periodStart && (
          <button
            type="button"
            onClick={() => setPeriodStart("")}
            className="text-muted-foreground hover:text-foreground pb-2 text-xs underline"
          >
            Limpiar rango
          </button>
        )}
        <p className="text-muted-foreground w-full text-xs">
          {periodStart
            ? `Mostrando movimientos del rango ${periodStart} a ${periodEnd}.`
            : "Sin 'desde': saldos acumulados hasta el corte."}
        </p>
      </div>

      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <BalanceTabs
          periodEnd={periodEnd}
          periodStart={periodStart || null}
        />
      </Suspense>
    </div>
  );
}

function BalanceTabs({
  periodEnd,
  periodStart,
}: {
  periodEnd: string;
  periodStart: string | null;
}) {
  const { data: rows } = useAccountBalances(periodEnd, periodStart);

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
        <EERRTab rows={rows} />
      </TabsContent>
      <TabsContent value="bg" className="mt-4">
        <BGTab rows={rows} />
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
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-red-500/40 bg-red-500/5",
        )}
      >
        {totals.isBalanced ? (
          <CheckCircle2 className="size-4 text-emerald-600" />
        ) : (
          <AlertTriangle className="size-4 text-red-600" />
        )}
        <span>
          {totals.isBalanced
            ? "Balance balanceado"
            : "Balance DESBALANCEADO"}
          : Σ Debe {money(totals.totalDebit)} · Σ Haber {money(totals.totalCredit)}
          {!totals.isBalanced && (
            <span className="ml-2 text-red-600">
              (diferencia {money(Math.abs(totals.totalDebit - totals.totalCredit))})
            </span>
          )}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-left text-xs">
            <tr>
              <th className="w-24 px-3 py-2 font-medium">Código</th>
              <th className="px-3 py-2 font-medium">Cuenta</th>
              <th className="w-32 px-3 py-2 text-right font-medium">Debe</th>
              <th className="w-32 px-3 py-2 text-right font-medium">Haber</th>
              <th className="w-32 px-3 py-2 text-right font-medium">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-12 text-center text-sm text-muted-foreground">
                  Sin movimientos hasta el período de corte.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.account_id} className="border-b last:border-b-0 hover:bg-muted/20">
                  <td className="px-3 py-1 font-mono text-xs">{r.account_code}</td>
                  <td className="px-3 py-1">{r.account_name}</td>
                  <td className="px-3 py-1 text-right font-mono">
                    {Number(r.total_debit) > 0 ? money(Number(r.total_debit)) : ""}
                  </td>
                  <td className="px-3 py-1 text-right font-mono">
                    {Number(r.total_credit) > 0 ? money(Number(r.total_credit)) : ""}
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
              <td colSpan={2} className="px-3 py-2 text-right text-xs">
                Totales
              </td>
              <td className="px-3 py-2 text-right font-mono">{money(totals.totalDebit)}</td>
              <td className="px-3 py-2 text-right font-mono">{money(totals.totalCredit)}</td>
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
    <div className="space-y-6">
      <Section title={eerr.ingresos.title} total={eerr.ingresos.total}>
        {eerr.ingresos.categories.map((c) => (
          <CategoryBlock key={c.name} name={c.name} total={c.total} rows={c.rows} sign={-1} />
        ))}
        {eerr.ingresos.categories.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            Sin ingresos en el período.
          </p>
        )}
      </Section>

      <Section title={eerr.gastos.title} total={eerr.gastos.total}>
        {eerr.gastos.categories.map((c) => (
          <CategoryBlock key={c.name} name={c.name} total={c.total} rows={c.rows} sign={1} />
        ))}
        {eerr.gastos.categories.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            Sin gastos en el período.
          </p>
        )}
      </Section>

      <div
        className={cn(
          "rounded-lg border p-4 text-center text-lg font-semibold",
          eerr.resultado >= 0
            ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
            : "border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300",
        )}
      >
        Resultado del período: {signed(eerr.resultado)}
        <Badge variant="outline" className="ml-2">
          {eerr.resultado >= 0 ? "Ganancia" : "Pérdida"}
        </Badge>
      </div>
    </div>
  );
}

function BGTab({ rows }: { rows: AccountBalanceRow[] }) {
  const grouped = useMemo(() => groupByType(rows), [rows]);

  const activo = grouped.find((g) => g.type === "activo");
  const pasivo = grouped.find((g) => g.type === "pasivo");
  const patrimonio = grouped.find((g) => g.type === "patrimonio");
  const respositivo = grouped.find((g) => g.type === "resultado_positivo");
  const resnegativo = grouped.find((g) => g.type === "resultado_negativo");

  const resultadoPeriodo =
    (respositivo ? -respositivo.total : 0) - (resnegativo ? resnegativo.total : 0);
  const totalPatrimonio = (patrimonio ? -patrimonio.total : 0) + resultadoPeriodo;
  const totalActivo = activo ? activo.total : 0;
  const totalPasivo = pasivo ? -pasivo.total : 0;
  const sumaPN = totalPasivo + totalPatrimonio;
  const cuadra = Math.abs(totalActivo - sumaPN) < 0.01;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4">
        {activo && <TypeBlock label="Activo" rows={activo.rows} total={totalActivo} />}
      </div>
      <div className="space-y-4">
        {pasivo && <TypeBlock label="Pasivo" rows={pasivo.rows} total={totalPasivo} />}
        {patrimonio && (
          <TypeBlock
            label="Patrimonio neto"
            rows={patrimonio.rows}
            total={totalPatrimonio}
            extraRow={{ label: "Resultado del período", amount: resultadoPeriodo }}
          />
        )}
        <div
          className={cn(
            "rounded-lg border p-3 text-sm font-semibold",
            cuadra
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-red-500/40 bg-red-500/5",
          )}
        >
          Total Pasivo + PN = {signed(sumaPN)} {cuadra ? "✓" : "✗"}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  total,
  children,
}: {
  title: string;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="font-mono font-medium">{signed(total)}</span>
      </div>
      <div className="divide-y">{children}</div>
    </div>
  );
}

function CategoryBlock({
  name,
  total,
  rows,
  sign,
}: {
  name: string;
  total: number;
  rows: AccountBalanceRow[];
  sign: 1 | -1;
}) {
  return (
    <details className="px-4 py-2">
      <summary className="flex cursor-pointer items-center justify-between text-sm">
        <span className="font-medium">{name}</span>
        <span className="font-mono">{signed(total)}</span>
      </summary>
      <ul className="mt-2 space-y-1 pl-3 text-xs">
        {rows.map((r) => (
          <li key={r.account_id} className="flex justify-between text-muted-foreground">
            <span>
              <span className="mr-2 font-mono">{r.account_code}</span>
              {r.account_name}
            </span>
            <span className="font-mono">{signed(Number(r.balance) * sign)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function TypeBlock({
  label,
  rows,
  total,
  extraRow,
}: {
  label: string;
  rows: AccountBalanceRow[];
  total: number;
  extraRow?: { label: string; amount: number };
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
            r.account_type === "pasivo" || r.account_type === "patrimonio" ? -1 : 1;
          return (
            <li key={r.account_id} className="flex justify-between px-4 py-1.5 text-xs">
              <span>
                <span className="mr-2 font-mono text-muted-foreground">
                  {r.account_code}
                </span>
                {r.account_name}
              </span>
              <span className="font-mono">{signed(Number(r.balance) * sign)}</span>
            </li>
          );
        })}
        {extraRow && (
          <li className="flex justify-between bg-muted/20 px-4 py-1.5 text-xs italic">
            <span>{extraRow.label}</span>
            <span className="font-mono">{signed(extraRow.amount)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
