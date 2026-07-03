"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";

import type { CashFlowChartData, CashFlowChartMonth } from "../schema";

const VB_W = 720;
const VB_H = 230;
const PAD_L = 56;
const PAD_R = 8;
const PAD_T = 14;
const PAD_B = 26;
const MAX_BAR_W = 28;
const END_RADIUS = 4;

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

function niceStep(rough: number): number {
  const pow = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / pow;
  if (unit <= 1) return pow;
  if (unit <= 2) return 2 * pow;
  if (unit <= 5) return 5 * pow;
  return 10 * pow;
}

/** Bar anchored at the zero baseline, rounded only at the data end. */
function barPath(
  x: number,
  yTop: number,
  w: number,
  h: number,
  roundTop: boolean,
): string {
  const r = Math.min(END_RADIUS, w / 2, h);
  if (h <= 0) return "";
  if (roundTop) {
    return [
      `M ${x} ${yTop + h}`,
      `V ${yTop + r}`,
      `Q ${x} ${yTop} ${x + r} ${yTop}`,
      `H ${x + w - r}`,
      `Q ${x + w} ${yTop} ${x + w} ${yTop + r}`,
      `V ${yTop + h}`,
      "Z",
    ].join(" ");
  }
  return [
    `M ${x} ${yTop}`,
    `V ${yTop + h - r}`,
    `Q ${x} ${yTop + h} ${x + r} ${yTop + h}`,
    `H ${x + w - r}`,
    `Q ${x + w} ${yTop + h} ${x + w} ${yTop + h - r}`,
    `V ${yTop}`,
    "Z",
  ].join(" ");
}

export function CashFlowChart({ data }: { data: CashFlowChartData }) {
  const hatchId = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const nets = data.months.map((m) => m.net);
    const rawMax = Math.max(0, ...nets);
    const rawMin = Math.min(0, ...nets);
    const span = rawMax - rawMin || 1;
    const yMax = rawMax + span * 0.08;
    const yMin = rawMin === 0 ? 0 : rawMin - span * 0.08;

    const innerH = VB_H - PAD_T - PAD_B;
    const innerW = VB_W - PAD_L - PAD_R;
    const yToPx = (v: number) =>
      PAD_T + ((yMax - v) / (yMax - yMin || 1)) * innerH;

    const step = niceStep((yMax - yMin) / 4 || 1);
    const ticks: number[] = [];
    for (let t = Math.ceil(yMin / step) * step; t <= yMax; t += step) {
      ticks.push(t);
    }

    const slot = innerW / Math.max(data.months.length, 1);
    const barW = Math.min(MAX_BAR_W, slot * 0.55);
    const firstProjected = data.months.findIndex((m) => !m.realized);

    return { yToPx, ticks, slot, barW, firstProjected };
  }, [data.months]);

  const { yToPx, ticks, slot, barW, firstProjected } = geometry;
  const zeroY = yToPx(0);

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b p-4">
        <div>
          <h2 className="text-sm font-medium">Flujo de caja</h2>
          <p className="text-xs text-muted-foreground">
            Neto mensual ARS · saldo hoy{" "}
            <span className="font-mono">{formatMoney(data.cashToday)}</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
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
          <Link
            href="/treasury/cash-flow"
            className="hover:text-foreground hover:underline"
          >
            Ver detalle
          </Link>
        </div>
      </div>

      <div className="relative p-2 text-foreground">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="w-full"
          role="img"
          aria-label={`Flujo de caja mensual, ${data.months.length} meses, realizado y proyectado.`}
        >
          <defs>
            <pattern
              id={hatchId}
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <rect
                width="6"
                height="6"
                fill="currentColor"
                opacity="0.12"
              />
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
                x1={PAD_L}
                x2={VB_W - PAD_R}
                y1={yToPx(t)}
                y2={yToPx(t)}
                stroke="currentColor"
                strokeOpacity={t === 0 ? 0.4 : 0.1}
              />
              <text
                x={PAD_L - 6}
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
              x1={PAD_L + firstProjected * slot}
              x2={PAD_L + firstProjected * slot}
              y1={PAD_T}
              y2={VB_H - PAD_B}
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeDasharray="3 3"
            />
          )}

          {data.months.map((m, i) => {
            const x = PAD_L + i * slot + (slot - barW) / 2;
            const vY = yToPx(m.net);
            const yTop = m.net >= 0 ? vY : zeroY;
            const h = Math.abs(vY - zeroY);
            const isHover = hovered === i;
            return (
              <g key={m.month}>
                {h >= 0.5 && (
                  <path
                    d={barPath(x, yTop, barW, h, m.net >= 0)}
                    fill={m.realized ? "currentColor" : `url(#${hatchId})`}
                    fillOpacity={m.realized ? (isHover ? 0.9 : 0.7) : 1}
                    stroke={m.realized ? "none" : "currentColor"}
                    strokeOpacity={isHover ? 0.8 : 0.5}
                  />
                )}
                <text
                  x={PAD_L + i * slot + slot / 2}
                  y={VB_H - PAD_B + 14}
                  textAnchor="middle"
                  fontSize="10"
                  fill="currentColor"
                  fillOpacity={isHover ? 0.9 : 0.55}
                >
                  {shortMonthLabel(m.month, i)}
                </text>
                <rect
                  x={PAD_L + i * slot}
                  y={PAD_T}
                  width={slot}
                  height={VB_H - PAD_T - PAD_B}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${monthLabel(m.month)}: entradas ${formatMoney(m.inTotal)}, salidas ${formatMoney(m.outTotal)}, neto ${formatMoney(m.net)}${m.closing != null ? `, saldo proyectado ${formatMoney(m.closing)}` : ""}`}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                />
              </g>
            );
          })}
        </svg>

        {hovered != null && data.months[hovered] && (
          <ChartTooltip
            month={data.months[hovered]}
            leftPct={((PAD_L + hovered * slot + slot / 2) / VB_W) * 100}
          />
        )}
      </div>

      {data.deficitMonth && (
        <div className="flex items-center gap-2 border-t p-3 text-xs text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          Proyección en negativo desde {monthLabel(data.deficitMonth)} (mínimo{" "}
          {formatMoney(data.lowestClosing ?? 0)}).
        </div>
      )}
    </section>
  );
}

function ChartTooltip({
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
