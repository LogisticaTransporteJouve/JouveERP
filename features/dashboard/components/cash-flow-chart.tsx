"use client";

import { AlertTriangle, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/ui/section";
import { barPath, niceStep } from "@/lib/chart-geometry";
import { formatMoney } from "@/lib/format";

import type { CashFlowChartData, CashFlowChartMonth } from "../schema";

const MAX_BAR_W = 28;
const PAD_R = 8;
const PAD_T = 14;
const PAD_B = 26;

const MES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MES[Number(m) - 1]} ${y}`;
}

function shortMonthLabel(ym: string, index: number): string {
  const [y, m] = ym.split("-");
  const name = MES[Number(m) - 1] ?? ym;
  return index === 0 || m === "01" ? `${name} ${y!.slice(2)}` : name;
}

const compactArs = new Intl.NumberFormat("es-AR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function CashFlowChart({ data }: { data: CashFlowChartData }) {
  const [hovered, setHovered] = useState<number | null>(null);

  // Compact (< md) window: the 2 most recent realized months + the next 4
  // projected. Fewer bars keep labels legible on a phone-width viewBox.
  const mobileMonths = useMemo(() => {
    const firstProjected = data.months.findIndex((m) => !m.realized);
    if (firstProjected < 0) return data.months.slice(-6);
    return data.months.slice(
      Math.max(0, firstProjected - 2),
      firstProjected + 4,
    );
  }, [data.months]);

  const [selected, setSelected] = useState<number>(() => {
    const realizedCount = mobileMonths.filter((m) => m.realized).length;
    return realizedCount > 0 ? realizedCount - 1 : 0;
  });

  const selectedMonth = mobileMonths[selected] ?? null;

  return (
    <Section
      title="Flujo de caja"
      icon={TrendingUp}
      description={
        <>
          Neto mensual en ARS
          {data.usdRate !== null ? " (USD al TC oficial)" : ""} · saldo hoy{" "}
          <span className="font-mono">{formatMoney(data.cashToday)}</span>
        </>
      }
      actions={
        <Link
          href="/treasury/cash-flow"
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          Ver detalle
        </Link>
      }
    >
      <div className="rounded-lg border bg-card">
        <div className="relative p-2 text-foreground max-md:hidden">
          <ChartSvg
            months={data.months}
            vbW={720}
            vbH={230}
            padL={56}
            active={hovered}
            interaction="hover"
            onActiveChange={setHovered}
          />
          {hovered != null && data.months[hovered] && (
            <FloatingTooltip
              month={data.months[hovered]}
              leftPct={
                ((56 +
                  (hovered + 0.5) * ((720 - 56 - PAD_R) / data.months.length)) /
                  720) *
                100
              }
            />
          )}
        </div>

        <div className="p-2 text-foreground md:hidden">
          <ChartSvg
            months={mobileMonths}
            vbW={360}
            vbH={200}
            padL={44}
            active={selected}
            interaction="tap"
            onActiveChange={(i) => {
              if (i != null) setSelected(i);
            }}
          />
          {selectedMonth && (
            <div className="mx-2 mb-1 rounded-md border bg-muted/30 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {monthLabel(selectedMonth.month)}
                </span>
                <Badge
                  variant={selectedMonth.realized ? "secondary" : "outline"}
                >
                  {selectedMonth.realized ? "Realizado" : "Proyectado"}
                </Badge>
              </div>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5">
                <TooltipRow
                  label="Entradas"
                  value={formatMoney(selectedMonth.inTotal)}
                />
                <TooltipRow
                  label="Salidas"
                  value={formatMoney(selectedMonth.outTotal)}
                />
                <TooltipRow
                  label="Neto"
                  value={formatMoney(selectedMonth.net)}
                />
                {selectedMonth.closing != null && (
                  <TooltipRow
                    label="Saldo proy."
                    value={formatMoney(selectedMonth.closing)}
                  />
                )}
              </dl>
            </div>
          )}
        </div>

        {data.deficitMonth && (
          <div className="flex items-center gap-2 border-t p-3 text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            Proyección en negativo desde {monthLabel(
              data.deficitMonth,
            )} (mínimo {formatMoney(data.lowestClosing ?? 0)}).
          </div>
        )}
        <div className="flex items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <svg width="12" height="12" aria-hidden="true">
              <rect
                width="12"
                height="12"
                rx="2"
                className="fill-foreground/70"
              />
            </svg>
            Realizado
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="12" height="12" aria-hidden="true">
              <rect
                width="12"
                height="12"
                rx="2"
                className="fill-foreground/15 stroke-foreground/50"
              />
              <line
                x1="0"
                y1="12"
                x2="12"
                y2="0"
                className="stroke-foreground/50"
              />
            </svg>
            Proyectado
          </span>
        </div>
      </div>
    </Section>
  );
}

function ChartSvg({
  months,
  vbW,
  vbH,
  padL,
  active,
  interaction,
  onActiveChange,
}: {
  months: CashFlowChartMonth[];
  vbW: number;
  vbH: number;
  padL: number;
  active: number | null;
  /** "hover" clears on leave/blur (floating tooltip); "tap" only sets. */
  interaction: "hover" | "tap";
  onActiveChange: (index: number | null) => void;
}) {
  const hatchId = useId();

  const geometry = useMemo(() => {
    const nets = months.map((m) => m.net);
    const rawMax = Math.max(0, ...nets);
    const rawMin = Math.min(0, ...nets);
    const span = rawMax - rawMin || 1;
    const yMax = rawMax + span * 0.08;
    const yMin = rawMin === 0 ? 0 : rawMin - span * 0.08;

    const innerH = vbH - PAD_T - PAD_B;
    const innerW = vbW - padL - PAD_R;
    const yToPx = (v: number) =>
      PAD_T + ((yMax - v) / (yMax - yMin || 1)) * innerH;

    const step = niceStep((yMax - yMin) / 4 || 1);
    const ticks: number[] = [];
    for (let t = Math.ceil(yMin / step) * step; t <= yMax; t += step) {
      ticks.push(t);
    }

    const slot = innerW / Math.max(months.length, 1);
    const barW = Math.min(MAX_BAR_W, slot * 0.55);
    const firstProjected = months.findIndex((m) => !m.realized);

    return { yToPx, ticks, slot, barW, firstProjected };
  }, [months, vbW, vbH, padL]);

  const { yToPx, ticks, slot, barW, firstProjected } = geometry;
  const zeroY = yToPx(0);

  return (
    <svg
      viewBox={`0 0 ${vbW} ${vbH}`}
      className="w-full"
      role="img"
      aria-label={`Flujo de caja mensual, ${months.length} meses, realizado y proyectado.`}
    >
      <defs>
        <pattern
          id={hatchId}
          patternUnits="userSpaceOnUse"
          width="6"
          height="6"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="currentColor" opacity="0.12" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.45"
          />
        </pattern>
      </defs>

      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={padL}
            x2={vbW - PAD_R}
            y1={yToPx(t)}
            y2={yToPx(t)}
            stroke="currentColor"
            strokeOpacity={t === 0 ? 0.4 : 0.1}
          />
          <text
            x={padL - 6}
            y={yToPx(t)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize="10"
            fill="currentColor"
            fillOpacity="0.55"
            className="font-mono"
          >
            {compactArs.format(t)}
          </text>
        </g>
      ))}

      {firstProjected > 0 && (
        <line
          x1={padL + firstProjected * slot}
          x2={padL + firstProjected * slot}
          y1={PAD_T}
          y2={vbH - PAD_B}
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeDasharray="3 3"
        />
      )}

      {months.map((m, i) => {
        const x = padL + i * slot + (slot - barW) / 2;
        const vY = yToPx(m.net);
        const yTop = m.net >= 0 ? vY : zeroY;
        const h = Math.abs(vY - zeroY);
        const isActive = active === i;
        return (
          <g key={m.month}>
            {h >= 0.5 && (
              <path
                d={barPath(x, yTop, barW, h, m.net >= 0 ? "top" : "bottom")}
                fill={m.realized ? "currentColor" : `url(#${hatchId})`}
                fillOpacity={m.realized ? (isActive ? 0.9 : 0.7) : 1}
                stroke={m.realized ? "none" : "currentColor"}
                strokeOpacity={isActive ? 0.8 : 0.5}
              />
            )}
            <text
              x={padL + i * slot + slot / 2}
              y={vbH - PAD_B + 14}
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
              fillOpacity={isActive ? 0.9 : 0.55}
            >
              {shortMonthLabel(m.month, i)}
            </text>
            <rect
              x={padL + i * slot}
              y={PAD_T}
              width={slot}
              height={vbH - PAD_T - PAD_B}
              fill="transparent"
              tabIndex={0}
              aria-label={`${monthLabel(m.month)}: entradas ${formatMoney(m.inTotal)}, salidas ${formatMoney(m.outTotal)}, neto ${formatMoney(m.net)}${m.closing != null ? `, saldo proyectado ${formatMoney(m.closing)}` : ""}`}
              onClick={() => onActiveChange(i)}
              onMouseEnter={
                interaction === "hover" ? () => onActiveChange(i) : undefined
              }
              onMouseLeave={
                interaction === "hover" ? () => onActiveChange(null) : undefined
              }
              onFocus={() => onActiveChange(i)}
              onBlur={
                interaction === "hover" ? () => onActiveChange(null) : undefined
              }
            />
          </g>
        );
      })}
    </svg>
  );
}

function FloatingTooltip({
  month,
  leftPct,
}: {
  month: CashFlowChartMonth;
  leftPct: number;
}) {
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 w-44 -translate-x-1/2 rounded-md border bg-popover p-2 text-xs shadow-md"
      style={{ left: `clamp(6rem, ${leftPct}%, calc(100% - 6rem))` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{monthLabel(month.month)}</span>
        <Badge variant={month.realized ? "secondary" : "outline"}>
          {month.realized ? "Realizado" : "Proyectado"}
        </Badge>
      </div>
      <dl className="mt-1.5 space-y-0.5">
        <TooltipRow label="Entradas" value={formatMoney(month.inTotal)} />
        <TooltipRow label="Salidas" value={formatMoney(month.outTotal)} />
        <TooltipRow label="Neto" value={formatMoney(month.net)} />
        {month.closing != null && (
          <TooltipRow label="Saldo proy." value={formatMoney(month.closing)} />
        )}
      </dl>
    </div>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
