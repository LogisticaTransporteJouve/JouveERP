"use client";

import { formatNumber2 } from "@/lib/format";

import type { Waterfall } from "../schema";

type Step = {
  label: string;
  value: number;
  /** A total starts at zero; a step starts where the previous one ended. */
  total: boolean;
};

export function waterfallSteps(w: Waterfall): Step[] {
  return [
    { label: "Servicios", value: w.serviceRevenue, total: false },
    { label: "Costos operativos", value: w.operatingCost, total: false },
    ...(w.unclassified !== 0
      ? [{ label: "Sin clasificar", value: w.unclassified, total: false }]
      : []),
    { label: "Margen operativo", value: w.operatingMargin, total: true },
    { label: "Costo financiero", value: w.financingCost, total: false },
    { label: "Después de financiación", value: w.afterFinancing, total: true },
    { label: "Capital de préstamos", value: w.loanPrincipal, total: false },
    { label: "Inversión en flota", value: w.fleetInvestment, total: false },
    { label: "Venta de bienes de uso", value: w.assetSale, total: false },
    ...(w.employeeAdvances !== 0
      ? [
          {
            label: "Anticipos al personal",
            value: w.employeeAdvances,
            total: false,
          },
        ]
      : []),
    { label: "Generación de caja", value: w.cashGeneration, total: true },
    ...(w.loanDisbursements !== 0
      ? [
          {
            label: "Financiamiento recibido",
            value: w.loanDisbursements,
            total: false,
          },
          { label: "Variación de caja", value: w.cashVariation, total: true },
        ]
      : []),
  ];
}

/** Where each bar starts and ends: a step from the previous end, a total
 *  from zero. */
export function waterfallBars(
  steps: readonly Step[],
): (Step & { start: number; end: number })[] {
  const bars: (Step & { start: number; end: number })[] = [];
  for (const s of steps) {
    const previous = bars.at(-1)?.end ?? 0;
    const start = s.total ? 0 : previous;
    bars.push({ ...s, start, end: s.total ? s.value : previous + s.value });
  }
  return bars;
}

const BAR = 44;
const GAP = 20;
const HEIGHT = 220;
const PAD_TOP = 16;
const LABEL_SPACE = 52;

/**
 * Monochrome cascade: increases are solid, decreases are outlined, totals
 * are solid and muted. Amounts are in the bar's title (hover / screen
 * readers) and in the table below.
 */
export function WaterfallChart({ waterfall }: { waterfall: Waterfall }) {
  const steps = waterfallSteps(waterfall);
  const bars = waterfallBars(steps);
  const values = bars.flatMap((b) => [b.start, b.end, 0]);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const y = (v: number) => PAD_TOP + ((max - v) / span) * HEIGHT;
  const width = steps.length * (BAR + GAP) + GAP;

  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label="Cascada del resultado de gestión"
        viewBox={`0 0 ${width} ${PAD_TOP + HEIGHT + LABEL_SPACE}`}
        className="h-72 min-w-[36rem] w-full text-foreground"
      >
        <line
          x1={0}
          x2={width}
          y1={y(0)}
          y2={y(0)}
          className="stroke-border"
          strokeWidth={1}
        />
        {bars.map((b, i) => {
          const x = GAP + i * (BAR + GAP);
          const top = y(Math.max(b.start, b.end));
          const h = Math.max(Math.abs(y(b.start) - y(b.end)), 1);
          const down = !b.total && b.value < 0;
          return (
            <g key={b.label}>
              <title>{`${b.label}: $${formatNumber2(b.value)}`}</title>
              <rect
                x={x}
                y={top}
                width={BAR}
                height={h}
                className={
                  b.total
                    ? "fill-muted-foreground"
                    : down
                      ? "fill-background stroke-foreground"
                      : "fill-foreground"
                }
                strokeWidth={down ? 1.5 : 0}
              />
              <text
                x={x + BAR / 2}
                y={PAD_TOP + HEIGHT + 14}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px]"
              >
                {b.label.split(" ").slice(0, 2).join(" ")}
              </text>
              {b.label.split(" ").length > 2 && (
                <text
                  x={x + BAR / 2}
                  y={PAD_TOP + HEIGHT + 26}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[9px]"
                >
                  {b.label.split(" ").slice(2).join(" ")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
