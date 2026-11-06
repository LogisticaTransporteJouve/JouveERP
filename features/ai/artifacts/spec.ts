import { z } from "zod";

/** Upper bounds that keep an artifact readable and its persisted part small. */
export const ARTIFACT_LIMITS = {
  chartPoints: 60,
  hbarPoints: 30,
  series: 3,
  /** A stacked bar shows the parts of a whole, so it takes more series. */
  stackedSeries: 6,
  tableRows: 300,
  tableColumns: 12,
  /** People (rows) of a month calendar, and the kinds its legend names. */
  calendarRows: 100,
  calendarKinds: 12,
  titleLength: 120,
  labelLength: 60,
  fieldLength: 64,
  /** Serialized size of a stored source input. */
  inputBytes: 2000,
  pinsPerUser: 30,
  /** Serialized size of one artifact's rows, and of all a turn emits. */
  partBytes: 100_000,
  turnBytes: 400_000,
} as const;

/** bar: grouped columns; stacked: columns whose series add up (parts of a
 *  whole, positives up and negatives down); hbar: a ranking; line: a trend. */
export const CHART_TYPES = ["bar", "stacked", "hbar", "line"] as const;

/** How numbers read: money in the artifact's currency, USD, percentages,
 *  counts (integers), kilometres or plain numbers. */
export const VALUE_FORMATS = [
  "money",
  "usd",
  "percent",
  "count",
  "km",
  "number",
] as const;
export type ValueFormat = (typeof VALUE_FORMATS)[number];
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

/** Which array of the query's result to read when it has more than one (e.g.
 *  getManagementPnL's byMonth); without it, the first array of objects. */
const dataset = fieldName.describe(
  "Optional: the key of the array in the query result to read (e.g. byMonth). Default: its first list of rows.",
);

/** Only a stacked bar takes more than ARTIFACT_LIMITS.series series. */
function seriesFitType(
  value: { type: ChartType; series?: readonly unknown[] },
  ctx: z.RefinementCtx,
): void {
  const max =
    value.type === "stacked"
      ? ARTIFACT_LIMITS.stackedSeries
      : ARTIFACT_LIMITS.series;
  if ((value.series?.length ?? 0) > max) {
    ctx.addIssue({
      code: "custom",
      path: ["series"],
      message: `A ${value.type} chart takes up to ${max} series.`,
    });
  }
}
const label = z.string().trim().min(1).max(ARTIFACT_LIMITS.labelLength);

/**
 * What the model chooses for a chart: the form and which row fields to plot.
 * Never values — the points come from the read action the server runs.
 * `x` and `series` default to the first label-like and first numeric field.
 */
export const chartConfigSchema = z
  .strictObject({
    type: z.enum(CHART_TYPES),
    title,
    dataset: dataset.optional(),
    x: fieldName.optional(),
    xLabel: label.optional(),
    series: z
      .array(z.strictObject({ field: fieldName, label: label.optional() }))
      .min(1)
      .max(ARTIFACT_LIMITS.stackedSeries)
      .refine((s) => unique(s.map((x) => x.field)), "Repeated series field.")
      .optional(),
    sort: z.enum(["none", "asc", "desc"]).optional(),
    limit: z.number().int().min(1).max(ARTIFACT_LIMITS.chartPoints).optional(),
    valueFormat: z.enum(VALUE_FORMATS).optional(),
  })
  .superRefine(seriesFitType);
export type ChartConfig = z.infer<typeof chartConfigSchema>;

/** The model's choice for a table: which row fields to show, in order, and
 *  their headers. */
export const tableConfigSchema = z.strictObject({
  title,
  dataset: dataset.optional(),
  columns: z
    .array(z.strictObject({ field: fieldName, label: label.optional() }))
    .min(1)
    .max(ARTIFACT_LIMITS.tableColumns)
    .refine((c) => unique(c.map((x) => x.field)), "Repeated column.")
    .optional(),
});
export type TableConfig = z.infer<typeof tableConfigSchema>;

const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "A month is YYYY-MM.");

/** The model's choice for a month calendar: the title and the month. The
 *  grid (who, which day, which kind) is built by the server from the rows. */
export const calendarConfigSchema = z.strictObject({
  title,
  dataset: dataset.optional(),
  month: month
    .optional()
    .describe(
      "YYYY-MM. Default: the month of the query's `from` (e.g. 2026-12).",
    ),
});
export type CalendarConfig = z.infer<typeof calendarConfigSchema>;

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

export const resolvedChartSchema = z
  .strictObject({
    type: z.enum(CHART_TYPES),
    title,
    dataset: fieldName.optional(),
    x: fieldName,
    xLabel: label,
    series: z
      .array(z.strictObject({ field: fieldName, label }))
      .min(1)
      .max(ARTIFACT_LIMITS.stackedSeries),
    sort: z.enum(["none", "asc", "desc"]),
    limit: z.number().int().min(1).max(ARTIFACT_LIMITS.chartPoints).optional(),
    valueFormat: z.enum(VALUE_FORMATS),
  })
  .superRefine(seriesFitType);
export type ResolvedChart = z.infer<typeof resolvedChartSchema>;

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type ArtifactCell = z.infer<typeof cellSchema>;

export const tableColumnSchema = z.strictObject({
  key: fieldName,
  label: z.string(),
  numeric: z.boolean(),
  format: z.enum(["text", ...VALUE_FORMATS]),
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
  dataset: fieldName.optional(),
  columns: z.array(tableColumnSchema).min(1).max(ARTIFACT_LIMITS.tableColumns),
  rows: z.array(z.array(cellSchema)).max(ARTIFACT_LIMITS.tableRows),
  /** Rows beyond the table's cap were left out. */
  truncated: z.boolean(),
  meta: metaSchema,
});

/** Between the codes of a calendar cell that two kinds cover ("V/E"). */
export const CALENDAR_CODE_SEPARATOR = "/";

/** A month as a grid: one row per person, one cell per day holding the codes
 *  of what covers that day ("" = nothing), and the legend of the codes. */
const calendarArtifactSchema = z.strictObject({
  kind: z.literal("calendar"),
  title,
  source: artifactSourceSchema,
  month,
  legend: z
    .array(z.strictObject({ code: z.string().min(1).max(2), label }))
    .max(ARTIFACT_LIMITS.calendarKinds),
  rows: z
    .array(
      z.strictObject({
        label: z.string(),
        cells: z.array(z.string().max(8)).min(28).max(31),
      }),
    )
    .max(ARTIFACT_LIMITS.calendarRows),
  /** People beyond the calendar's cap were left out. */
  truncated: z.boolean(),
  meta: metaSchema,
});

/** The payload of a `data-artifact` message part (and of a pinned view). */
export const artifactSchema = z.discriminatedUnion("kind", [
  chartArtifactSchema,
  tableArtifactSchema,
  calendarArtifactSchema,
]);
export type Artifact = z.infer<typeof artifactSchema>;
export type ChartArtifact = z.infer<typeof chartArtifactSchema>;
export type TableArtifact = z.infer<typeof tableArtifactSchema>;
export type CalendarArtifact = z.infer<typeof calendarArtifactSchema>;
/** What a pin can rebuild: a calendar is shown in the chat only. */
export type PinnableArtifact = ChartArtifact | TableArtifact;

export const RENDER_CHART_TOOL = "renderChart";
export const RENDER_TABLE_TOOL = "renderTable";
export const RENDER_CALENDAR_TOOL = "renderCalendar";

/** The tools that render an artifact instead of returning rows. */
export const RENDER_TOOLS: readonly string[] = [
  RENDER_CHART_TOOL,
  RENDER_TABLE_TOOL,
  RENDER_CALENDAR_TOOL,
];

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

/** What an artifact tool asks the server to build: a pinnable chart or
 *  table, or a month calendar. */
export type ArtifactRequest =
  | PinRequest
  | { kind: "calendar"; source: ArtifactSource; config: CalendarConfig };

/** The pin request that rebuilds an artifact the user is looking at. */
export function pinRequestOf(artifact: PinnableArtifact): PinRequest {
  if (artifact.kind === "chart") {
    const {
      type,
      title: t,
      dataset: d,
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
        ...(d ? { dataset: d } : {}),
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
      ...(artifact.dataset ? { dataset: artifact.dataset } : {}),
      columns: artifact.columns.map((c) => ({ field: c.key, label: c.label })),
    },
  };
}
