import { getToolName, isToolUIPart } from "ai";
import { z } from "zod";

import { resolveRows } from "../artifacts/rows";
import { RENDER_CHART_TOOL, RENDER_TABLE_TOOL } from "../artifacts/spec";

import type { ChatPart } from "./chat-segments";

/** One tool call of a turn, as the activity block lists it. */
export type ActivityStep = {
  toolCallId: string;
  name: string;
  status: "running" | "done" | "error";
  /** Rows the query returned, when it returned a list (not counted for the
   *  artifact tools: their chart or table is shown in the answer). */
  rows: number | null;
  sources: readonly string[];
  asOf: string | null;
  partial: boolean;
  /** The step's output, for the expandable preview. */
  output: unknown;
};

const resultSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  meta: z
    .object({
      sources: z.array(z.string()),
      asOf: z.string(),
      partial: z.boolean(),
    })
    .optional(),
});

/** The turn's tool calls, in order, except those shown as cards. */
export function activitySteps(
  parts: readonly ChatPart[],
  isCard: (part: ChatPart) => boolean,
): ActivityStep[] {
  const steps: ActivityStep[] = [];
  for (const part of parts) {
    if (!isToolUIPart(part) || isCard(part)) continue;
    const base = {
      toolCallId: part.toolCallId,
      name: getToolName(part),
      rows: null,
      sources: [],
      asOf: null,
      partial: false,
      output: undefined,
    };
    if (part.state === "output-error") {
      steps.push({ ...base, status: "error" });
      continue;
    }
    if (part.state !== "output-available") {
      steps.push({ ...base, status: "running" });
      continue;
    }
    const result = resultSchema.safeParse(part.output);
    if (!result.success || !result.data.ok) {
      steps.push({ ...base, status: "error" });
      continue;
    }
    steps.push({
      ...base,
      status: "done",
      rows:
        base.name === RENDER_CHART_TOOL || base.name === RENDER_TABLE_TOOL
          ? null
          : (resolveRows(result.data.data)?.length ?? null),
      sources: result.data.meta?.sources ?? [],
      asOf: result.data.meta?.asOf ?? null,
      partial: result.data.meta?.partial ?? false,
      output: part.output,
    });
  }
  return steps;
}
