import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { AiAction, AiActionContext } from "../registry/define";
import { errResult, modelOutput, type AiToolResult } from "../registry/result";

import { runArtifact } from "./run";
import type { AiArtifactSink } from "./sink";
import {
  CALENDAR_CODE_SEPARATOR,
  RENDER_CALENDAR_TOOL,
  RENDER_CHART_TOOL,
  RENDER_TABLE_TOOL,
  artifactSourceSchema,
  calendarConfigSchema,
  chartConfigSchema,
  tableConfigSchema,
  type Artifact,
  type ArtifactRequest,
} from "./spec";

/** Rows of a table artifact the model gets back to talk about. */
const MODEL_TABLE_ROWS = 10;

const sourceShape = {
  action: artifactSourceSchema.shape.action.describe(
    "Name of one of your read queries (e.g. getExpenseByCategory).",
  ),
  input: artifactSourceSchema.shape.input
    .default({})
    .describe("The input that query takes, exactly as when you call it."),
};

/** What the model reads back: enough to talk about the artifact without the
 *  whole payload, with the source query's provenance. */
function modelResult(artifact: Artifact): AiToolResult {
  const meta = {
    sources: artifact.meta.sources,
    asOf: artifact.meta.asOf,
    partial: artifact.meta.partial || artifact.truncated,
    ...(artifact.meta.currency ? { currency: artifact.meta.currency } : {}),
    ...(artifact.meta.note ? { note: artifact.meta.note } : {}),
  };
  const cut = artifact.truncated ? " (cut to the display cap)" : "";
  if (artifact.kind === "calendar") {
    const legend = artifact.legend.map((l) => `${l.code} = ${l.label}`);
    return {
      ok: true,
      summary: `Calendar "${artifact.title}" of ${artifact.month} shown to the user: ${artifact.rows.length} rows${cut}; legend: ${legend.join(", ")}. The user can export it to CSV.`,
      data: {
        month: artifact.month,
        legend: artifact.legend,
        // The days each row has marked, by code, for the model to talk about.
        rows: artifact.rows.map((r) => ({
          label: r.label,
          days: Object.fromEntries(
            artifact.legend.map((l) => [
              l.code,
              r.cells.flatMap((c, i) =>
                c.split(CALENDAR_CODE_SEPARATOR).includes(l.code)
                  ? [i + 1]
                  : [],
              ),
            ]),
          ),
        })),
      },
      meta,
    };
  }
  if (artifact.kind === "chart") {
    const series = artifact.chart.series.map((s) => s.label);
    return {
      ok: true,
      summary: `Chart "${artifact.title}" shown to the user: ${artifact.points.length} points of ${artifact.chart.xLabel}${cut}; series: ${series.join(", ")}.`,
      data: { series, points: artifact.points },
      meta,
    };
  }
  return {
    ok: true,
    summary: `Table "${artifact.title}" shown to the user: ${artifact.rows.length} rows${cut}, columns: ${artifact.columns.map((c) => c.label).join(", ")}. The user can export it to CSV.`,
    data: {
      columns: artifact.columns.map((c) => c.key),
      firstRows: artifact.rows.slice(0, MODEL_TABLE_ROWS),
    },
    meta,
  };
}

async function render(
  ctx: AiActionContext,
  sink: AiArtifactSink,
  request: ArtifactRequest,
  toolCallId: string,
  actions?: readonly AiAction[],
): Promise<AiToolResult> {
  const run = await runArtifact(ctx, request, actions);
  if (!run.ok) return errResult(run.error);
  if (!sink.emit(toolCallId, run.artifact)) {
    return errResult(
      "This answer already shows as many charts and tables as fit; say what else the user can ask for in a new message.",
    );
  }
  return modelResult(run.artifact);
}

/** renderChart, renderTable and renderCalendar, bound to one user and one
 *  chat stream. */
export { RENDER_CALENDAR_TOOL, RENDER_CHART_TOOL, RENDER_TABLE_TOOL };

export function buildArtifactTools(
  ctx: AiActionContext,
  sink: AiArtifactSink,
  actions?: readonly AiAction[],
): ToolSet {
  return {
    [RENDER_CHART_TOOL]: tool({
      description:
        "Show the user a chart built from one of your read queries. The server runs " +
        "the query with the given input and plots its rows: you choose the form " +
        "(bar: compare categories or periods; stacked: the parts of a whole per " +
        "period or category, e.g. costs by category per month; hbar: rankings with " +
        "long names; line: a trend over time) and which row fields to plot, never " +
        "the values. x must be one value per row (a period, a name): use a query " +
        "already grouped by it. When the result has several lists (e.g. " +
        "getManagementPnL's byMonth), name the one to plot in dataset. Up to 3 " +
        "series (6 in stacked) that share a unit (valueFormat: money = pesos, usd, " +
        "percent, km, count); never mix amounts with counts, km or percentages in " +
        "one chart. Write the title and the x and series labels in Spanish for the " +
        "user. If it fails, the error lists the fields or lists you can use.",
      inputSchema: z.object({ ...sourceShape, chart: chartConfigSchema }),
      toModelOutput: ({ output }) => modelOutput(output),
      execute: ({ action, input, chart }, { toolCallId }) =>
        render(
          ctx,
          sink,
          { kind: "chart", source: { action, input }, config: chart },
          toolCallId,
          actions,
        ),
    }),
    [RENDER_TABLE_TOOL]: tool({
      description:
        "Show the user a table built from one of your read queries, with CSV export. " +
        "The server runs the query with the given input; you choose the title and, " +
        "optionally, which row fields to show in order with Spanish headers (and " +
        "the dataset, when the result has several lists). Use it " +
        "when the user asks for a list or a table, or to export.",
      inputSchema: z.object({ ...sourceShape, table: tableConfigSchema }),
      toModelOutput: ({ output }) => modelOutput(output),
      execute: ({ action, input, table }, { toolCallId }) =>
        render(
          ctx,
          sink,
          { kind: "table", source: { action, input }, config: table },
          toolCallId,
          actions,
        ),
    }),
    [RENDER_CALENDAR_TOOL]: tool({
      description:
        "Show the user a month as a calendar grid: one row per employee, one " +
        "column per day, each day marked with the code of its kind (V " +
        "vacaciones, E enfermedad, F franco…), with a legend and CSV export. " +
        "Build it from getLeavesByRange (its rows carry employee, kind, " +
        "start_date and end_date); the server marks the days, you only choose " +
        "the Spanish title and the month (YYYY-MM, default the query's from). " +
        "Use it when the user asks who is off in a month, or for a calendar of " +
        "vacations or leaves.",
      inputSchema: z.object({ ...sourceShape, calendar: calendarConfigSchema }),
      toModelOutput: ({ output }) => modelOutput(output),
      execute: ({ action, input, calendar }, { toolCallId }) =>
        render(
          ctx,
          sink,
          { kind: "calendar", source: { action, input }, config: calendar },
          toolCallId,
          actions,
        ),
    }),
  };
}
