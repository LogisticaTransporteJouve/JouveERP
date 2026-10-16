import { csvFileName, toCsv } from "@/lib/export/csv";

import type { Artifact } from "./spec";

/** The artifact's rows as CSV, from what the user is already looking at:
 *  raw values (numbers stay numeric), headers as shown. */
export function artifactCsv(artifact: Artifact): {
  fileName: string;
  csv: string;
} {
  const fileName = csvFileName(artifact.title);
  if (artifact.kind === "chart") {
    return {
      fileName,
      csv: toCsv(
        [artifact.chart.xLabel, ...artifact.chart.series.map((s) => s.label)],
        artifact.points.map((p) => [p.x, ...p.values]),
      ),
    };
  }
  return {
    fileName,
    csv: toCsv(
      artifact.columns.map((c) => c.label),
      artifact.rows,
    ),
  };
}
