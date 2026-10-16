"use client";

import { cn } from "@/lib/utils";

import { formatCell, formatValue } from "../artifacts/format";
import type { Artifact, ArtifactCell, TableColumn } from "../artifacts/spec";

type Grid = { columns: TableColumn[]; rows: ArtifactCell[][] };

/** The rows of any artifact as a grid (a chart's points become its table
 *  view, so the figures never depend on reading the marks). */
function gridOf(artifact: Artifact): Grid {
  if (artifact.kind === "table") {
    return { columns: artifact.columns, rows: artifact.rows };
  }
  const money = artifact.chart.valueFormat === "money";
  return {
    columns: [
      {
        key: artifact.chart.x,
        label: artifact.chart.xLabel,
        numeric: false,
        money: false,
      },
      ...artifact.chart.series.map((s) => ({
        key: s.field,
        label: s.label,
        numeric: true,
        money,
      })),
    ],
    rows: artifact.points.map((p) => [p.x, ...p.values]),
  };
}

export function ArtifactTable({
  artifact,
  maxHeight = "max-h-80",
}: {
  artifact: Artifact;
  maxHeight?: string;
}) {
  const { columns, rows } = gridOf(artifact);
  const currency = artifact.meta.currency ?? "ARS";
  const percent =
    artifact.kind === "chart" && artifact.chart.valueFormat === "percent";
  return (
    <div className={cn("overflow-auto rounded-md border text-xs", maxHeight)}>
      <table className="w-full">
        <thead className="bg-muted sticky top-0">
          <tr className="text-muted-foreground border-b">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "px-2 py-1 font-medium whitespace-nowrap",
                  c.numeric ? "text-right" : "text-left",
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b last:border-0">
              {columns.map((c, i) => {
                const value = row[i] ?? null;
                return (
                  <td
                    key={c.key}
                    className={cn(
                      "px-2 py-1",
                      c.numeric && "text-right font-mono tabular-nums",
                    )}
                  >
                    {percent && typeof value === "number"
                      ? formatValue(value, "percent")
                      : formatCell(c, value, currency)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
