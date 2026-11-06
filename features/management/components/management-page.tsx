"use client";

import { Download, Info } from "lucide-react";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCsv, toCsv } from "@/lib/export/csv";
import { downloadBlob } from "@/lib/export/download";
import { fiscalYearLabel } from "@/lib/fiscal-year";
import { formatNumber2, todayInAR } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  useLogManagementExport,
  useManagementReport,
} from "../hooks/use-management";
import { money, monthLabel } from "../lib/format";
import {
  ALL_COST_CENTERS,
  INTERNAL_USE_NOTICE,
  MANAGEMENT_BASES,
  MANAGEMENT_BASIS_LABEL,
  NO_COST_CENTER,
  SIDE_VIEWS,
  TABLE_LINES,
  buildMonthTable,
  computeKpis,
  computeWaterfall,
  costCenterBreakdown,
  filterByCostCenter,
  isManagementBasis,
  isSideView,
  monthTableExport,
  unclassifiedAccounts,
  type Kpi,
  type ManagementReportInput,
  type SideView,
} from "../schema";
import { BucketDialog } from "./bucket-dialog";
import { DrillDialog, type DrillCell } from "./drill-dialog";
import { VehicleMarginSection } from "./vehicle-margin-section";
import { WaterfallChart } from "./waterfall-chart";

const SIDE_LABEL: Record<SideView, string> = {
  total: "Total",
  fiscal: "Fiscal",
  internal: "Interno",
};

function kpiValue(kpi: Kpi, value: number | null): string {
  if (value === null) return "—";
  return kpi.unit === "pct" ? `${formatNumber2(value)} %` : money(value);
}

function kpiVariance(kpi: Kpi): string {
  if (kpi.variance === null) return "sin datos del año anterior";
  const sign = kpi.variance > 0 ? "+" : "";
  if (kpi.unit === "pct") return `${sign}${formatNumber2(kpi.variance)} pp`;
  const base = kpi.previous ? Math.abs(kpi.previous) : 0;
  const rel =
    base === 0
      ? ""
      : ` (${sign}${formatNumber2((kpi.variance / base) * 100)} %)`;
  return `${sign}${money(kpi.variance)}${rel}`;
}

export function ManagementPage({
  initialInput,
  canEdit,
}: {
  initialInput: ManagementReportInput;
  canEdit: boolean;
}) {
  const [input, setInput] = useState(initialInput);
  const years = Array.from(
    { length: 5 },
    (_, i) => initialInput.fiscalYear - i,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            Resultado de gestión
            <Badge variant="outline">Uso interno</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            Fiscal + interno: ¿la operación deja plata? No es el EERR fiscal ni
            se presenta a bancos o ARCA (para eso, Balance / EERR).
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Año fiscal (oct–sep)</Label>
          <Select
            value={String(input.fiscalYear)}
            onValueChange={(v) => setInput({ ...input, fiscalYear: Number(v) })}
          >
            <SelectTrigger className="w-36" aria-label="Año fiscal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {years.map((fy) => (
                <SelectItem key={fy} value={String(fy)}>
                  {fiscalYearLabel(fy)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Base</Label>
          <Select
            value={input.basis}
            onValueChange={(v) => {
              if (isManagementBasis(v)) setInput({ ...input, basis: v });
            }}
          >
            <SelectTrigger className="w-36" aria-label="Base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {MANAGEMENT_BASES.map((b) => (
                <SelectItem key={b} value={b}>
                  {MANAGEMENT_BASIS_LABEL[b]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Checkbox
            checked={input.inflation}
            onCheckedChange={(c) =>
              setInput({ ...input, inflation: c === true })
            }
          />
          Ajustado por inflación
        </label>
      </div>

      <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            Limitaciones de esta versión
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              Una cuota de préstamo sin desglose va entera a capital; con
              desglose se separan capital e intereses (en Percibido, el IVA y la
              percepción de la cuota van con los intereses).
            </li>
            <li>
              Por centro de costo cuenta solo lo cargado con centro (compras,
              egresos manuales y documentos); el resto va a «Sin centro». En
              Percibido, los pagos con orden de pago no llevan el centro de la
              compra.
            </li>
            <li>
              En Percibido, un cobro o un pago cuenta como venta de bien de uso,
              inversión en flota o anticipo al personal según lo que imputó; lo
              cobrado o pagado a cuenta (sin imputar) va a servicios o a pagos a
              proveedores.
            </li>
            <li>
              El margen por camión suma lo cargado con el centro de costo de
              cada camión; un camión sin centro vinculado solo lleva sus viajes,
              combustible y mantenimiento.
            </li>
          </ul>
        </div>
      </div>

      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ManagementReportView input={input} canEdit={canEdit} />
      </Suspense>
    </div>
  );
}

function ManagementReportView({
  input,
  canEdit,
}: {
  input: ManagementReportInput;
  canEdit: boolean;
}) {
  const { data } = useManagementReport(input);
  const [sideView, setSideView] = useState<SideView>("total");
  const [costCenter, setCostCenter] = useState<string>(ALL_COST_CENTERS);
  const [drill, setDrill] = useState<DrillCell | null>(null);
  const logExport = useLogManagementExport();

  const rows = useMemo(
    () => filterByCostCenter(data.rows, costCenter),
    [data.rows, costCenter],
  );
  const waterfall = useMemo(() => computeWaterfall(rows), [rows]);
  const previous = useMemo(
    () => computeWaterfall(filterByCostCenter(data.previousRows, costCenter)),
    [data.previousRows, costCenter],
  );
  const table = useMemo(
    () => buildMonthTable(rows, data.months),
    [rows, data.months],
  );
  const breakdown = useMemo(() => costCenterBreakdown(data.rows), [data.rows]);
  const centerById = useMemo(
    () => new Map(data.costCenters.map((c) => [c.id, c])),
    [data.costCenters],
  );
  const centerLabel = (id: string | null) => {
    if (id === null) return "Sin centro";
    const c = centerById.get(id);
    return c ? `${c.code} · ${c.name}` : "Centro eliminado";
  };
  const unclassified = useMemo(
    () => unclassifiedAccounts(data.rows),
    [data.rows],
  );
  const accountById = useMemo(
    () => new Map(data.accounts.map((a) => [a.id, a])),
    [data.accounts],
  );

  const kpis = useMemo(
    () =>
      computeKpis(
        rows,
        filterByCostCenter(data.previousRows, costCenter),
        data.months,
        todayInAR().slice(0, 7),
      ),
    [rows, data.previousRows, data.months, costCenter],
  );

  async function exportTable(format: "csv" | "xlsx") {
    const { header, rows: lines } = monthTableExport(
      table,
      data.months,
      sideView,
    );
    const scope =
      costCenter === ALL_COST_CENTERS
        ? "Todos los centros"
        : centerLabel(costCenter === NO_COST_CENTER ? null : costCenter);
    const title = `Resultado de gestión ${fiscalYearLabel(input.fiscalYear)}`;
    const subtitle = `${MANAGEMENT_BASIS_LABEL[input.basis]}${
      input.inflation ? " ajustado por inflación" : ""
    } · ${scope} · meses en ${SIDE_LABEL[sideView]}`;
    const fileBase = `gestion-uso-interno-${input.fiscalYear}-${input.basis}`;
    try {
      if (format === "csv") {
        downloadCsv(
          fileBase,
          toCsv(header, [[INTERNAL_USE_NOTICE], [title, subtitle], ...lines]),
        );
      } else {
        const { buildXlsx } = await import("@/lib/export/xlsx");
        const file = await buildXlsx({
          name: "Gestión (uso interno)",
          preamble: [title, subtitle, INTERNAL_USE_NOTICE],
          columns: header.map((h, i) => ({
            header: h,
            type: i === 0 ? "text" : "money",
          })),
          rows: lines,
        });
        downloadBlob(`${fileBase}.xlsx`, file);
      }
    } catch {
      toast.error("No se pudo generar el archivo.");
      return;
    }
    logExport.mutate({
      ...input,
      format,
      side: sideView,
      costCenter,
    });
  }

  const summary: { label: string; current: number; previous: number }[] = [
    {
      label: "Margen operativo",
      current: waterfall.operatingMargin,
      previous: previous.operatingMargin,
    },
    {
      label: "Resultado después de financiación",
      current: waterfall.afterFinancing,
      previous: previous.afterFinancing,
    },
    {
      label: "Generación de caja",
      current: waterfall.cashGeneration,
      previous: previous.cashGeneration,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Label className="text-xs">Centro de costo</Label>
        <Select value={costCenter} onValueChange={setCostCenter}>
          <SelectTrigger
            className="w-full max-w-72"
            aria-label="Centro de costo"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ALL_COST_CENTERS}>Todos</SelectItem>
            {data.costCenters.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.code} · {c.name}
              </SelectItem>
            ))}
            <SelectItem value={NO_COST_CENTER}>Sin centro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {data.partial && (
        <div className="flex gap-2 rounded-lg border p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            Las cifras pueden estar incompletas: el resultado llegó al tope de
            filas que se pueden leer o trae filas que esta versión no sabe
            clasificar.
          </p>
        </div>
      )}

      {waterfall.pendingUsd !== 0 && (
        <div className="flex gap-2 rounded-lg border p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            Hay movimientos en dólares sin pasar a pesos (neto US$
            {formatNumber2(waterfall.pendingUsd)}) que no están sumados: les
            falta la cotización o, si son fiscales, el asiento. Cargá la
            cotización en{" "}
            <Link href="/accounting/exchange-rates" className="underline">
              Cotización USD
            </Link>
            ; si ya está, el asiento faltante figura en el{" "}
            <Link href="/accounting/package" className="underline">
              Paquete del mes
            </Link>
            .
          </p>
        </div>
      )}

      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {kpis.kpis.map((k) => (
            <div key={k.key} className="rounded-lg border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="font-mono text-lg font-semibold">
                {kpiValue(k, k.current)}
              </p>
              <p className="text-xs text-muted-foreground">
                Mismo período anterior: {kpiValue(k, k.previous)} ·{" "}
                <span className="font-mono">{kpiVariance(k)}</span>
              </p>
            </div>
          ))}
        </div>
        {kpis.months.length > 0 && kpis.months.length < data.months.length && (
          <p className="text-xs text-muted-foreground">
            Indicadores de {monthLabel(kpis.months[0]!)} a{" "}
            {monthLabel(kpis.months.at(-1)!)} contra los mismos meses del año
            anterior.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">
            Cascada del año fiscal
            {costCenter !== ALL_COST_CENTERS &&
              ` · ${centerLabel(costCenter === NO_COST_CENTER ? null : costCenter)}`}
          </h2>
          <WaterfallChart waterfall={waterfall} />
        </div>
        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3 text-sm font-medium">
            Comparativo con el año anterior
          </div>
          <dl className="divide-y text-sm">
            {summary.map((s) => (
              <div key={s.label} className="space-y-1 px-4 py-3">
                <dt className="text-xs text-muted-foreground">{s.label}</dt>
                <dd className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-base font-semibold">
                    {money(s.current)}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    año anterior {money(s.previous)}
                  </span>
                </dd>
              </div>
            ))}
            {waterfall.excludedNoncash !== 0 && (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                Fuera del cálculo (amortizaciones, RECPAM):{" "}
                <span className="font-mono">
                  {money(waterfall.excludedNoncash)}
                </span>
              </div>
            )}
          </dl>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-medium">Mes a mes</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportTable("csv")}
            >
              <Download className="size-4" />
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportTable("xlsx")}
            >
              <Download className="size-4" />
              Excel
            </Button>
            <Label className="text-xs text-muted-foreground">Meses en</Label>
            <Select
              value={sideView}
              onValueChange={(v) => {
                if (isSideView(v)) setSideView(v);
              }}
            >
              <SelectTrigger className="h-8 w-28" aria-label="Meses en">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {SIDE_VIEWS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {SIDE_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-xs">
            <thead className="bg-muted/30 text-muted-foreground">
              <tr>
                <th className="sticky left-0 bg-muted/30 px-3 py-2 text-left">
                  Concepto
                </th>
                {data.months.map((m) => (
                  <th key={m} className="px-2 py-2 text-right font-normal">
                    {monthLabel(m)}
                  </th>
                ))}
                <th className="border-l px-2 py-2 text-right">Fiscal</th>
                <th className="px-2 py-2 text-right">Interno</th>
                <th className="px-2 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {TABLE_LINES.map((line) => {
                const totals = table.totals[line.key]!;
                return (
                  <tr
                    key={line.key}
                    className={cn(
                      "border-t",
                      line.kind !== "line" && "font-semibold",
                      line.kind === "total" && "bg-muted/30",
                    )}
                  >
                    <td
                      className={cn(
                        "sticky left-0 bg-card px-3 py-1.5",
                        line.kind === "total" && "bg-muted/30",
                      )}
                      style={{ paddingLeft: `${0.75 + line.depth}rem` }}
                    >
                      {line.label}
                    </td>
                    {data.months.map((m) => (
                      <AmountCell
                        key={m}
                        amount={table.byMonth[line.key]![m]![sideView]}
                        onOpen={(amount) =>
                          setDrill({
                            lineKey: line.key,
                            lineLabel: line.label,
                            fromPeriod: m,
                            toPeriod: m,
                            side: sideView,
                            amount,
                          })
                        }
                      />
                    ))}
                    {(["fiscal", "internal", "total"] as const).map((side) => (
                      <AmountCell
                        key={side}
                        className={side === "fiscal" ? "border-l" : undefined}
                        amount={totals[side]}
                        onOpen={(amount) =>
                          setDrill({
                            lineKey: line.key,
                            lineLabel: line.label,
                            fromPeriod: data.months[0]!,
                            toPeriod: data.months.at(-1)!,
                            side,
                            amount,
                          })
                        }
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <DrillDialog
        cell={drill}
        basis={input.basis}
        inflation={input.inflation}
        costCenter={costCenter}
        onClose={() => setDrill(null)}
      />

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-medium">Por centro de costo</h2>
          <p className="text-xs text-muted-foreground">
            Año fiscal completo, fiscal + interno. Elegí un centro arriba para
            ver su cascada y su mes a mes.
          </p>
        </div>
        {breakdown.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Sin movimientos en el año.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-xs">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Centro</th>
                  <th className="px-3 py-2 text-right">Servicios</th>
                  <th className="px-3 py-2 text-right">Costos operativos</th>
                  <th className="px-3 py-2 text-right">Sin clasificar</th>
                  <th className="px-3 py-2 text-right">Margen operativo</th>
                  <th className="px-3 py-2 text-right">Inversión en flota</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map(({ costCenterId, waterfall: w }) => (
                  <tr key={costCenterId ?? NO_COST_CENTER} className="border-t">
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        className="text-left underline-offset-2 hover:underline"
                        onClick={() =>
                          setCostCenter(costCenterId ?? NO_COST_CENTER)
                        }
                      >
                        {centerLabel(costCenterId)}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {money(w.serviceRevenue)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {money(w.operatingCost)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {money(w.unclassified)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold">
                      {money(w.operatingMargin)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {money(w.fleetInvestment)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <VehicleMarginSection
        fromPeriod={data.months[0]!}
        toPeriod={data.months.at(-1)!}
        basis={input.basis}
        inflation={input.inflation}
        centerLabel={centerLabel}
      />

      {(unclassified.length > 0 || canEdit) && (
        <div className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="text-sm font-medium">Sin clasificar</h2>
            {canEdit && <BucketDialog accounts={data.accounts} />}
          </div>
          {unclassified.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Todas las cuentas con movimientos tienen caja.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {unclassified.map((u) => {
                const account = u.accountId
                  ? accountById.get(u.accountId)
                  : undefined;
                return (
                  <li
                    key={u.accountId ?? "none"}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                  >
                    <span>
                      {account ? (
                        <>
                          <span className="mr-2 font-mono text-xs text-muted-foreground">
                            {account.code}
                          </span>
                          {account.name}
                        </>
                      ) : (
                        "Sin cuenta del plan (rol sin cuenta asignada)"
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono">{money(u.amount)}</span>
                      {canEdit && account && (
                        <BucketDialog
                          accounts={data.accounts}
                          focusAccountId={account.id}
                          trigger={
                            <button
                              type="button"
                              className="text-xs underline underline-offset-2"
                            >
                              Clasificar
                            </button>
                          }
                        />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-medium">
            Sueldos: pagado en el mes vs. liquidado del período
          </h2>
          <p className="text-xs text-muted-foreground">
            Un saldo impago alto marca planillas sin cerrar o pagos sin cargar.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-xs">
            <thead className="bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Mes</th>
                <th className="px-3 py-2 text-right">Liquidado</th>
                <th className="px-3 py-2 text-right">Pagado del período</th>
                <th className="px-3 py-2 text-right">Saldo impago</th>
                <th className="px-3 py-2 text-right">Pagado en el mes</th>
              </tr>
            </thead>
            <tbody>
              {data.payroll.map((p) => (
                <tr key={p.month} className="border-t">
                  <td className="px-3 py-1.5">{monthLabel(p.month)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {money(p.liquidated)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {money(p.paidForPeriod)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono",
                      p.unpaid > 0 && "font-semibold",
                    )}
                  >
                    {money(p.unpaid)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {money(p.paidInMonth)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** A figure of the month table; a non-zero one opens its documents. */
function AmountCell({
  amount,
  onOpen,
  className,
}: {
  amount: number;
  onOpen: (amount: number) => void;
  className?: string;
}) {
  return (
    <td className={cn("px-2 py-1.5 text-right font-mono", className)}>
      {amount === 0 ? (
        money(amount)
      ) : (
        <button
          type="button"
          className="underline-offset-2 hover:underline focus-visible:underline"
          onClick={() => onOpen(amount)}
          aria-label={`Ver documentos de ${money(amount)}`}
        >
          {money(amount)}
        </button>
      )}
    </td>
  );
}
