import { csvFileName, toCsv } from "@/lib/export/csv";
import { exportFileName } from "@/lib/export/download";
import type { XlsxColumn, XlsxColumnType, XlsxSheet } from "@/lib/export/xlsx";

import type { Artifact, ArtifactCell, ValueFormat } from "./spec";

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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;

/** A text column whose every value is an ISO date is written as dates. */
function textColumnType(values: readonly ArtifactCell[]): XlsxColumnType {
  const present = values.filter((v) => v !== null && v !== "");
  return present.length > 0 &&
    present.every((v) => typeof v === "string" && ISO_DATE.test(v))
    ? "date"
    : "text";
}

function valueColumn(
  header: string,
  format: ValueFormat,
  currency: string,
): XlsxColumn {
  if (format === "money") return { header, type: "money", currency };
  if (format === "usd") return { header, type: "money", currency: "USD" };
  if (format === "count") return { header, type: "integer" };
  if (format === "percent") return { header, type: "percent" };
  return { header, type: "number" };
}

/** The same rows as `artifactCsv`, typed for a spreadsheet. */
export function artifactXlsx(artifact: Artifact): {
  fileName: string;
  sheet: XlsxSheet;
} {
  const fileName = exportFileName(artifact.title, "xlsx");
  const currency = artifact.meta.currency ?? "ARS";
  if (artifact.kind === "chart") {
    const { chart, points } = artifact;
    return {
      fileName,
      sheet: {
        name: artifact.title,
        columns: [
          {
            header: chart.xLabel,
            type: textColumnType(points.map((p) => p.x)),
          },
          ...chart.series.map((s) =>
            valueColumn(s.label, chart.valueFormat, currency),
          ),
        ],
        rows: points.map((p) => [p.x, ...p.values]),
      },
    };
  }
  return {
    fileName,
    sheet: {
      name: artifact.title,
      columns: artifact.columns.map((c, i) =>
        c.format === "text"
          ? {
              header: c.label,
              type: textColumnType(artifact.rows.map((r) => r[i] ?? null)),
            }
          : valueColumn(c.label, c.format, currency),
      ),
      rows: artifact.rows,
    },
  };
}
