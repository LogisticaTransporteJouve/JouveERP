import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { AiAction, AiActionContext } from "../registry/define";
import { errResult, type AiToolResult } from "../registry/result";

import { runArtifact } from "./run";
import type { AiArtifactSink } from "./sink";
import {
  RENDER_CHART_TOOL,
  RENDER_TABLE_TOOL,
  artifactSourceSchema,
  chartConfigSchema,
  tableConfigSchema,
  type Artifact,
  type PinRequest,
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
    partial: artifact.meta.partial,
    ...(artifact.meta.currency ? { currency: artifact.meta.currency } : {}),
    ...(artifact.meta.note ? { note: artifact.meta.note } : {}),
  };
  const cut = artifact.truncated ? " (cut to the display cap)" : "";
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
  request: PinRequest,
  toolCallId: string,
  actions?: readonly AiAction[],
): Promise<AiToolResult> {
  const run = await runArtifact(ctx, request, actions);
  if (!run.ok) return errResult(run.error);
  sink.emit(toolCallId, run.artifact);
  return modelResult(run.artifact);
}

/** renderChart and renderTable, bound to one user and one chat stream. */
export { RENDER_CHART_TOOL, RENDER_TABLE_TOOL };

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
        "(bar: compare categories or periods; hbar: rankings with long names; line: " +
        "a trend over time) and which row fields to plot, never the values. x must " +
        "be one value per row (a period, a name): use a query already grouped by it. " +
        "Up to 3 series that share a unit; never mix amounts with counts or " +
        "percentages in one chart. Write the title and the x and series labels in " +
        "Spanish for the user. If it fails, the error lists the fields you can use.",
      inputSchema: z.object({ ...sourceShape, chart: chartConfigSchema }),
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
        "optionally, which row fields to show in order with Spanish headers. Use it " +
        "when the user asks for a list or a table, or to export.",
      inputSchema: z.object({ ...sourceShape, table: tableConfigSchema }),
      execute: ({ action, input, table }, { toolCallId }) =>
        render(
          ctx,
          sink,
          { kind: "table", source: { action, input }, config: table },
          toolCallId,
          actions,
        ),
    }),
  };
}
