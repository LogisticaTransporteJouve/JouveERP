"use client";

import { useMemo, useState } from "react";

import {
  barPath,
  niceTicks,
  stackExtent,
  stackSegments,
} from "@/lib/chart-geometry";

import {
  formatAxisValue,
  formatCategory,
  formatTick,
  formatValue,
  pointDetails,
  tickIndices,
} from "../artifacts/format";
import type { ChartArtifact } from "../artifacts/spec";

// Monochrome: series differ by ink strength and, on lines, by dash pattern.
// The only colour is the primary ring on the focused point (house UI rule).
const SERIES_OPACITY = [0.8, 0.45, 0.2];
const STACK_OPACITY = [0.85, 0.66, 0.5, 0.36, 0.24, 0.14];
const SERIES_DASH = [undefined, "6 4", "2 3"];
const BAR_GAP = 2;
const HIT_CLASS = "outline-none focus-visible:stroke-primary";

function seriesOpacity(type: ChartArtifact["chart"]["type"], i: number) {
  return (
    (type === "stacked" ? STACK_OPACITY[i] : SERIES_OPACITY[i]) ??
    STACK_OPACITY.at(-1) ??
    0.14
  );
}

const VB_W = 640;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 28;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The y (or x, for horizontal bars) domain: always includes zero; a stacked
 *  column reaches the sum of each side. */
function domain(points: ChartArtifact["points"], stacked = false) {
  const values = stacked
    ? points.flatMap((p) => {
        const { min, max } = stackExtent(p.values);
        return [min, max];
      })
    : points.flatMap((p) => p.values.filter((v): v is number => v !== null));
  const min = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const max = rawMax === min ? min + 1 : rawMax;
  const ticks = niceTicks(min, max);
  return {
    lo: Math.min(ticks[0] ?? min, min),
    hi: Math.max(ticks.at(-1) ?? max, max),
    ticks,
  };
}

type ChartProps = { artifact: ChartArtifact };

export function ArtifactChart({ artifact }: ChartProps) {
  return (
    <div className="space-y-2">
      {artifact.chart.series.length > 1 && <Legend artifact={artifact} />}
      {artifact.chart.type === "hbar" ? (
        <HorizontalBars artifact={artifact} />
      ) : (
        <ColumnsOrLines artifact={artifact} />
      )}
    </div>
  );
}

function Legend({ artifact }: ChartProps) {
  const line = artifact.chart.type === "line";
  return (
    <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {artifact.chart.series.map((s, i) => (
        <li key={s.field} className="flex items-center gap-1.5">
          <svg
            width="16"
            height="10"
            aria-hidden="true"
            className="text-foreground"
          >
            {line ? (
              <line
                x1="0"
                y1="5"
                x2="16"
                y2="5"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={SERIES_DASH[i]}
              />
            ) : (
              <rect
                x="3"
                width="10"
                height="10"
                rx="2"
                fill="currentColor"
                fillOpacity={seriesOpacity(artifact.chart.type, i)}
              />
            )}
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({
  artifact,
  index,
  leftPct,
  topPct,
}: {
  artifact: ChartArtifact;
  index: number;
  leftPct: number;
  topPct?: number;
}) {
  const point = artifact.points[index];
  if (!point) return null;
  const currency = artifact.meta.currency ?? "ARS";
  const about = pointDetails(artifact, index);
  return (
    <div
      className="bg-popover pointer-events-none absolute z-10 w-56 -translate-x-1/2 rounded-md border p-2 text-xs shadow-md"
      style={{
        left: `clamp(7rem, ${leftPct}%, calc(100% - 7rem))`,
        top: topPct === undefined ? "0.25rem" : `${topPct}%`,
      }}
    >
      <p className="font-medium">{formatCategory(point.x)}</p>
      {about.length > 0 && (
        <dl className="text-muted-foreground mt-1 space-y-0.5">
          {about.map((d) => (
            <div key={d.label} className="flex justify-between gap-2">
              <dt className="shrink-0">{d.label}</dt>
              <dd className="text-foreground truncate">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <dl
        className={`mt-1 space-y-0.5${about.length > 0 ? " border-t pt-1" : ""}`}
      >
        {artifact.chart.series.map((s, i) => (
          <div
            key={s.field}
            className="flex items-center justify-between gap-2"
          >
            <dt className="text-muted-foreground truncate">{s.label}</dt>
            <dd className="font-mono">
              {formatValue(
                point.values[i] ?? null,
                artifact.chart.valueFormat,
                currency,
              )}
            </dd>
          </div>
        ))}
        {artifact.chart.type === "stacked" && (
          <div className="flex items-center justify-between gap-2 border-t pt-0.5">
            <dt className="text-muted-foreground">Total</dt>
            <dd className="font-mono">
              {formatValue(
                point.values.some((v) => v !== null)
                  ? point.values.reduce<number>((a, v) => a + (v ?? 0), 0)
                  : null,
                artifact.chart.valueFormat,
                currency,
              )}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function pointLabel(artifact: ChartArtifact, index: number): string {
  const point = artifact.points[index];
  if (!point) return "";
  const currency = artifact.meta.currency ?? "ARS";
  const values = artifact.chart.series
    .map(
      (s, i) =>
        `${s.label}: ${formatValue(point.values[i] ?? null, artifact.chart.valueFormat, currency)}`,
    )
    .join(", ");
  const about = pointDetails(artifact, index)
    .map((d) => `${d.label} ${d.value}`)
    .join(", ");
  return `${formatCategory(point.x)}${about ? ` (${about})` : ""}: ${values}`;
}

function ColumnsOrLines({ artifact }: ChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const { chart, points } = artifact;
  const currency = artifact.meta.currency ?? "ARS";
  const vbH = 240;
  const padL = 64;

  const stacked = chart.type === "stacked";
  const geo = useMemo(() => {
    const { lo, hi, ticks } = domain(points, stacked);
    const innerH = vbH - PAD_T - PAD_B;
    const innerW = VB_W - padL - PAD_R;
    const y = (v: number) => PAD_T + ((hi - v) / (hi - lo || 1)) * innerH;
    const slot = innerW / Math.max(points.length, 1);
    const k = stacked ? 1 : chart.series.length;
    const barW = Math.max(
      2,
      Math.min(stacked ? 32 : 24, (slot * 0.7 - BAR_GAP * (k - 1)) / k),
    );
    const labelled = new Set(tickIndices(points.map((p) => p.tick ?? p.x)));
    return { y, ticks, slot, barW, labelled };
  }, [points, chart.series.length, padL, stacked]);

  const { y, ticks, slot, barW, labelled } = geo;
  const zeroY = y(0);
  const cx = (i: number) => padL + i * slot + slot / 2;
  const k = stacked ? 1 : chart.series.length;
  const groupW = k * barW + (k - 1) * BAR_GAP;

  return (
    <div className="text-foreground relative">
      <svg
        viewBox={`0 0 ${VB_W} ${vbH}`}
        className="w-full"
        role="img"
        aria-label={`${artifact.title}: ${points.length} puntos.`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={VB_W - PAD_R}
              y1={y(t)}
              y2={y(t)}
              stroke="currentColor"
              strokeOpacity={t === 0 ? 0.4 : 0.1}
            />
            <text
              x={padL - 6}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="10"
              fill="currentColor"
              fillOpacity="0.55"
              className="font-mono"
            >
              {formatAxisValue(t, chart.valueFormat, currency)}
            </text>
          </g>
        ))}

        {chart.type === "bar" &&
          points.map((p, i) =>
            p.values.map((v, s) => {
              if (v === null) return null;
              const x0 = padL + i * slot + (slot - groupW) / 2;
              const top = v >= 0 ? y(v) : zeroY;
              return (
                <path
                  key={`${p.x}-${s}`}
                  d={barPath(
                    x0 + s * (barW + BAR_GAP),
                    top,
                    barW,
                    Math.abs(y(v) - zeroY),
                    v >= 0 ? "top" : "bottom",
                  )}
                  fill="currentColor"
                  fillOpacity={
                    (SERIES_OPACITY[s] ?? 0.2) + (active === i ? 0.15 : 0)
                  }
                />
              );
            }),
          )}

        {stacked &&
          points.map((p, i) => {
            const segments = stackSegments(p.values);
            // Only the outermost segment of each side gets the rounded end.
            const lastUp = segments.findLastIndex(
              (g) => g !== null && g.to > 0,
            );
            const lastDown = segments.findLastIndex(
              (g) => g !== null && g.to < 0,
            );
            const x0 = padL + i * slot + (slot - barW) / 2;
            return segments.map((g, s) => {
              if (!g) return null;
              const up = g.to > 0;
              const outer = s === (up ? lastUp : lastDown);
              return (
                <path
                  key={`${p.x}-${s}`}
                  d={barPath(
                    x0,
                    Math.min(y(g.from), y(g.to)),
                    barW,
                    Math.abs(y(g.to) - y(g.from)),
                    up ? "top" : "bottom",
                    outer ? 4 : 0,
                  )}
                  fill="currentColor"
                  fillOpacity={
                    seriesOpacity("stacked", s) + (active === i ? 0.1 : 0)
                  }
                />
              );
            });
          })}

        {chart.type === "line" &&
          chart.series.map((s, si) => {
            let d = "";
            let pen = false;
            points.forEach((p, i) => {
              const v = p.values[si];
              if (v === null || v === undefined) {
                pen = false;
                return;
              }
              d += `${pen ? "L" : "M"} ${cx(i)} ${y(v)} `;
              pen = true;
            });
            return (
              <path
                key={s.field}
                d={d}
                fill="none"
                stroke="currentColor"
                strokeOpacity={si === 0 ? 0.85 : 0.6}
                strokeWidth="2"
                strokeDasharray={SERIES_DASH[si]}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}

        {chart.type === "line" && active !== null && (
          <g>
            <line
              x1={cx(active)}
              x2={cx(active)}
              y1={PAD_T}
              y2={vbH - PAD_B}
              stroke="currentColor"
              strokeOpacity="0.25"
            />
            {points[active]?.values.map((v, si) =>
              v === null ? null : (
                <circle
                  key={si}
                  cx={cx(active)}
                  cy={y(v)}
                  r="4"
                  className="fill-background"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              ),
            )}
          </g>
        )}

        {points.map((p, i) => (
          <g key={p.x}>
            {labelled.has(i) && (
              <text
                x={cx(i)}
                y={vbH - PAD_B + 14}
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
                fillOpacity={active === i ? 0.9 : 0.55}
              >
                {clip(formatTick(p.tick ?? p.x), 14)}
              </text>
            )}
            <rect
              x={padL + i * slot}
              y={PAD_T}
              width={slot}
              height={vbH - PAD_T - PAD_B}
              fill="transparent"
              strokeWidth="2"
              className={HIT_CLASS}
              tabIndex={0}
              aria-label={pointLabel(artifact, i)}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          </g>
        ))}
      </svg>
      {active !== null && (
        <Tooltip
          artifact={artifact}
          index={active}
          leftPct={(cx(active) / VB_W) * 100}
        />
      )}
    </div>
  );
}

function HorizontalBars({ artifact }: ChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const { chart, points } = artifact;
  const currency = artifact.meta.currency ?? "ARS";
  const rowH = 24;
  const padL = 150;
  const vbH = PAD_T + points.length * rowH + PAD_B;

  const { lo, hi, ticks } = useMemo(() => domain(points), [points]);
  const innerW = VB_W - padL - PAD_R;
  const x = (v: number) => padL + ((v - lo) / (hi - lo || 1)) * innerW;
  const zeroX = x(0);
  const k = chart.series.length;
  const barH = Math.max(2, (rowH * 0.7 - BAR_GAP * (k - 1)) / k);
  const groupH = k * barH + (k - 1) * BAR_GAP;

  return (
    <div className="text-foreground relative">
      <svg
        viewBox={`0 0 ${VB_W} ${vbH}`}
        className="w-full"
        role="img"
        aria-label={`${artifact.title}: ${points.length} filas.`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={PAD_T}
              y2={vbH - PAD_B}
              stroke="currentColor"
              strokeOpacity={t === 0 ? 0.4 : 0.1}
            />
            <text
              x={x(t)}
              y={vbH - PAD_B + 14}
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
              fillOpacity="0.55"
              className="font-mono"
            >
              {formatAxisValue(t, chart.valueFormat, currency)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const rowY = PAD_T + i * rowH;
          return (
            <g key={p.x}>
              <text
                x={padL - 8}
                y={rowY + rowH / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="11"
                fill="currentColor"
                fillOpacity={active === i ? 0.95 : 0.7}
              >
                {clip(formatCategory(p.x), 24)}
              </text>
              {p.values.map((v, s) => {
                if (v === null) return null;
                const left = v >= 0 ? zeroX : x(v);
                return (
                  <path
                    key={s}
                    d={barPath(
                      left,
                      rowY + (rowH - groupH) / 2 + s * (barH + BAR_GAP),
                      Math.abs(x(v) - zeroX),
                      barH,
                      v >= 0 ? "right" : "left",
                    )}
                    fill="currentColor"
                    fillOpacity={
                      (SERIES_OPACITY[s] ?? 0.2) + (active === i ? 0.15 : 0)
                    }
                  />
                );
              })}
              <rect
                x={0}
                y={rowY}
                width={VB_W}
                height={rowH}
                fill="transparent"
                strokeWidth="2"
                className={HIT_CLASS}
                tabIndex={0}
                aria-label={pointLabel(artifact, i)}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            </g>
          );
        })}
      </svg>
      {active !== null && (
        <Tooltip
          artifact={artifact}
          index={active}
          leftPct={((padL + innerW / 2) / VB_W) * 100}
          topPct={((PAD_T + (active + 1) * rowH) / vbH) * 100}
        />
      )}
    </div>
  );
}
