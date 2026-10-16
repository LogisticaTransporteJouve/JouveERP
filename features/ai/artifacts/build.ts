import {
  fieldFormat,
  fieldsOf,
  isArtifactField,
  isIdKey,
  isNumericField,
  prettifyKey,
  toNumber,
  type DataRow,
} from "./rows";
import {
  ARTIFACT_LIMITS,
  type ArtifactCell,
  type ArtifactMeta,
  type ArtifactSource,
  type ChartArtifact,
  type ChartConfig,
  type ResolvedChart,
  type TableArtifact,
  type TableColumn,
  type TableConfig,
  type ValueFormat,
} from "./spec";

export type BuildResult<T> =
  { ok: true; value: T } | { ok: false; error: string };

type Input = { source: ArtifactSource; rows: DataRow[]; meta: ArtifactMeta };

/** Fields an artifact may name: the rows' keys that pass the spec's rule. */
function usableFields(rows: readonly DataRow[]): string[] {
  return fieldsOf(rows).filter(isArtifactField);
}

/** A numeric field's format; a code never reaches here (it is not numeric). */
function numberFormat(field: string): ValueFormat {
  const format = fieldFormat(field);
  return format === "code" ? "number" : format;
}

/** The fields the model can use, for an error it can recover from. */
function fieldHint(rows: readonly DataRow[]): string {
  const fields = usableFields(rows).filter((f) => !isIdKey(f));
  const numeric = fields.filter((f) => isNumericField(rows, f));
  const labels = fields.filter((f) => !numeric.includes(f));
  return `Label fields: ${labels.join(", ") || "(none)"}. Numeric fields: ${numeric.join(", ") || "(none)"}.`;
}

const MAX_X = 80;

function xValue(value: unknown): string | null {
  const text =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";
  if (!text) return null;
  return text.length > MAX_X ? `${text.slice(0, MAX_X - 1)}…` : text;
}

/** The series' common format; plain numbers when they differ. */
function sharedFormat(fields: readonly string[]): ValueFormat {
  const formats = new Set(fields.map(numberFormat));
  const [only] = formats;
  return formats.size === 1 && only ? only : "number";
}

/**
 * The chart the model asked for, over rows the server loaded. Values are
 * copied from the rows, never computed: an `x` that repeats is refused
 * instead of summed, so the model has to pick a query that is already
 * grouped by that field.
 */
export function buildChartArtifact(
  config: ChartConfig,
  { source, rows, meta }: Input,
): BuildResult<ChartArtifact> {
  const fields = usableFields(rows);
  const numeric = fields.filter((f) => !isIdKey(f) && isNumericField(rows, f));

  const x = config.x ?? fields.find((f) => !isIdKey(f) && !numeric.includes(f));
  if (!x || !fields.includes(x)) {
    return {
      ok: false,
      error: `Field "${config.x ?? ""}" is not in the result. ${fieldHint(rows)}`,
    };
  }

  const series = (config.series ?? [{ field: numeric[0] ?? "" }]).map((s) => ({
    field: s.field,
    label: s.label ?? prettifyKey(s.field),
  }));
  for (const s of series) {
    if (!numeric.includes(s.field) || s.field === x) {
      return {
        ok: false,
        error: `Field "${s.field}" is not a numeric field of the result. ${fieldHint(rows)}`,
      };
    }
  }

  const seen = new Set<string>();
  let points: ChartArtifact["points"] = [];
  for (const row of rows) {
    const key = xValue(row[x]);
    if (key === null) continue;
    if (seen.has(key)) {
      return {
        ok: false,
        error: `"${x}" repeats ("${key}"): the rows are not one per ${x}. Use a summary query grouped by that field.`,
      };
    }
    seen.add(key);
    points.push({ x: key, values: series.map((s) => toNumber(row[s.field])) });
  }
  if (points.length === 0) {
    return { ok: false, error: "The result has no rows to chart." };
  }

  const sort = config.sort ?? "none";
  if (sort !== "none") {
    const dir = sort === "asc" ? 1 : -1;
    // Points without a first value go last either way.
    points = [...points].sort((a, b) => {
      const va = a.values[0] ?? null;
      const vb = b.values[0] ?? null;
      if (va === null || vb === null) {
        return (va === null ? 1 : 0) - (vb === null ? 1 : 0);
      }
      return dir * (va - vb);
    });
  }
  const cap = Math.min(
    config.limit ?? ARTIFACT_LIMITS.chartPoints,
    config.type === "hbar"
      ? ARTIFACT_LIMITS.hbarPoints
      : ARTIFACT_LIMITS.chartPoints,
  );
  const truncated = points.length > cap;

  const chart: ResolvedChart = {
    type: config.type,
    title: config.title,
    x,
    xLabel: config.xLabel ?? prettifyKey(x),
    series,
    sort,
    ...(config.limit ? { limit: config.limit } : {}),
    valueFormat: config.valueFormat ?? sharedFormat(series.map((s) => s.field)),
  };
  return {
    ok: true,
    value: {
      kind: "chart",
      title: config.title,
      source,
      chart,
      points: points.slice(0, cap),
      truncated,
      meta,
    },
  };
}

const MAX_TEXT = 200;

function toCell(value: unknown): ArtifactCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  }
  return null;
}

/** The table the model asked for: the chosen (or first) fields of the rows,
 *  numeric strings as numbers so the export keeps them numeric, codes and
 *  identifiers as text. */
export function buildTableArtifact(
  config: TableConfig,
  { source, rows, meta }: Input,
): BuildResult<TableArtifact> {
  const fields = usableFields(rows);
  const chosen =
    config.columns ??
    fields
      .filter((f) => !isIdKey(f))
      .filter((f) => rows.some((r) => toCell(r[f]) !== null))
      .slice(0, ARTIFACT_LIMITS.tableColumns)
      .map((field) => ({ field, label: undefined }));
  const missing = chosen.find((c) => !fields.includes(c.field))?.field;
  if (missing) {
    return {
      ok: false,
      error: `Field "${missing}" is not in the result. ${fieldHint(rows)}`,
    };
  }
  if (chosen.length === 0) {
    return { ok: false, error: "The result has no columns to show." };
  }
  const columns: TableColumn[] = chosen.map(({ field, label }) => {
    const numeric = isNumericField(rows, field);
    return {
      key: field,
      label: label ?? prettifyKey(field),
      numeric,
      format: numeric ? numberFormat(field) : "text",
    };
  });
  let shown = rows
    .slice(0, ARTIFACT_LIMITS.tableRows)
    .map((row) =>
      columns.map((c) =>
        c.numeric ? toNumber(row[c.key]) : toCell(row[c.key]),
      ),
    );
  // Wide text cells can make even 300 rows heavy; the part stays bounded.
  while (
    shown.length > 1 &&
    JSON.stringify(shown).length > ARTIFACT_LIMITS.partBytes
  ) {
    shown = shown.slice(0, Math.floor(shown.length * 0.8));
  }
  const truncated = rows.length > shown.length;
  return {
    ok: true,
    value: {
      kind: "table",
      title: config.title,
      source,
      columns,
      rows: shown,
      truncated,
      meta,
    },
  };
}
