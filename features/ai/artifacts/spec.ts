import { z } from "zod";

/** Upper bounds that keep an artifact readable and its persisted part small. */
export const ARTIFACT_LIMITS = {
  chartPoints: 60,
  hbarPoints: 30,
  series: 3,
  tableRows: 300,
  tableColumns: 12,
  titleLength: 120,
  labelLength: 60,
  fieldLength: 64,
  /** Serialized size of a stored source input. */
  inputBytes: 2000,
  pinsPerUser: 30,
} as const;

export const CHART_TYPES = ["bar", "hbar", "line"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

const fieldName = z
  .string()
  .trim()
  .min(1)
  .max(ARTIFACT_LIMITS.fieldLength)
  .regex(/^[A-Za-z0-9_]+$/, "Field names are plain row keys.");

const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;

const title = z.string().trim().min(1).max(ARTIFACT_LIMITS.titleLength);
const label = z.string().trim().min(1).max(ARTIFACT_LIMITS.labelLength);

/**
 * What the model chooses for a chart: the form and which row fields to plot.
 * Never values — the points come from the read action the server runs.
 * `x` and `series` default to the first label-like and first numeric field.
 */
export const chartConfigSchema = z.strictObject({
  type: z.enum(CHART_TYPES),
  title,
  x: fieldName.optional(),
  xLabel: label.optional(),
  series: z
    .array(z.strictObject({ field: fieldName, label: label.optional() }))
    .min(1)
    .max(ARTIFACT_LIMITS.series)
    .refine((s) => unique(s.map((x) => x.field)), "Repeated series field.")
    .optional(),
  sort: z.enum(["none", "asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(ARTIFACT_LIMITS.chartPoints).optional(),
  valueFormat: z.enum(["money", "number", "percent"]).optional(),
});
export type ChartConfig = z.infer<typeof chartConfigSchema>;

/** The model's choice for a table: which row fields to show, in order, and
 *  their headers. */
export const tableConfigSchema = z.strictObject({
  title,
  columns: z
    .array(z.strictObject({ field: fieldName, label: label.optional() }))
    .min(1)
    .max(ARTIFACT_LIMITS.tableColumns)
    .refine((c) => unique(c.map((x) => x.field)), "Repeated column.")
    .optional(),
});
export type TableConfig = z.infer<typeof tableConfigSchema>;

/** The registry read action an artifact is built from, and its input. */
export const artifactSourceSchema = z.strictObject({
  action: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_]+$/),
  input: z
    .record(z.string(), z.unknown())
    .refine(
      (value) => JSON.stringify(value).length <= ARTIFACT_LIMITS.inputBytes,
      "Input too large.",
    ),
});
export type ArtifactSource = z.infer<typeof artifactSourceSchema>;

const metaSchema = z.strictObject({
  sources: z.array(z.string()),
  asOf: z.string(),
  partial: z.boolean(),
  currency: z.string().optional(),
  note: z.string().optional(),
});
export type ArtifactMeta = z.infer<typeof metaSchema>;

export const resolvedChartSchema = z.strictObject({
  type: z.enum(CHART_TYPES),
  title,
  x: fieldName,
  xLabel: label,
  series: z
    .array(z.strictObject({ field: fieldName, label }))
    .min(1)
    .max(ARTIFACT_LIMITS.series),
  sort: z.enum(["none", "asc", "desc"]),
  limit: z.number().int().min(1).max(ARTIFACT_LIMITS.chartPoints).optional(),
  valueFormat: z.enum(["money", "number", "percent"]),
});
export type ResolvedChart = z.infer<typeof resolvedChartSchema>;

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type ArtifactCell = z.infer<typeof cellSchema>;

export const tableColumnSchema = z.strictObject({
  key: fieldName,
  label: z.string(),
  numeric: z.boolean(),
  money: z.boolean(),
});
export type TableColumn = z.infer<typeof tableColumnSchema>;

const chartArtifactSchema = z.strictObject({
  kind: z.literal("chart"),
  title,
  source: artifactSourceSchema,
  chart: resolvedChartSchema,
  points: z
    .array(
      z.strictObject({
        x: z.string(),
        values: z.array(z.number().nullable()),
      }),
    )
    .max(ARTIFACT_LIMITS.chartPoints),
  /** Rows beyond the chart's cap were left out. */
  truncated: z.boolean(),
  meta: metaSchema,
});

const tableArtifactSchema = z.strictObject({
  kind: z.literal("table"),
  title,
  source: artifactSourceSchema,
  columns: z.array(tableColumnSchema).min(1).max(ARTIFACT_LIMITS.tableColumns),
  rows: z.array(z.array(cellSchema)).max(ARTIFACT_LIMITS.tableRows),
  /** Rows beyond the table's cap were left out. */
  truncated: z.boolean(),
  meta: metaSchema,
});

/** The payload of a `data-artifact` message part (and of a pinned view). */
export const artifactSchema = z.discriminatedUnion("kind", [
  chartArtifactSchema,
  tableArtifactSchema,
]);
export type Artifact = z.infer<typeof artifactSchema>;
export type ChartArtifact = z.infer<typeof chartArtifactSchema>;
export type TableArtifact = z.infer<typeof tableArtifactSchema>;

export const RENDER_CHART_TOOL = "renderChart";
export const RENDER_TABLE_TOOL = "renderTable";

/** The UI message part type the chat streams artifacts as. */
export const ARTIFACT_PART = "data-artifact";

/** What the client asks to pin: the source and the config, never the data. */
export const pinRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("chart"),
    source: artifactSourceSchema,
    config: chartConfigSchema,
  }),
  z.strictObject({
    kind: z.literal("table"),
    source: artifactSourceSchema,
    config: tableConfigSchema,
  }),
]);
export type PinRequest = z.infer<typeof pinRequestSchema>;

/** The pin request that rebuilds an artifact the user is looking at. */
export function pinRequestOf(artifact: Artifact): PinRequest {
  if (artifact.kind === "chart") {
    const {
      type,
      title: t,
      x,
      xLabel,
      series,
      sort,
      limit,
      valueFormat,
    } = artifact.chart;
    return {
      kind: "chart",
      source: artifact.source,
      config: {
        type,
        title: t,
        x,
        xLabel,
        series,
        sort,
        ...(limit ? { limit } : {}),
        valueFormat,
      },
    };
  }
  return {
    kind: "table",
    source: artifact.source,
    config: {
      title: artifact.title,
      columns: artifact.columns.map((c) => ({ field: c.key, label: c.label })),
    },
  };
}
