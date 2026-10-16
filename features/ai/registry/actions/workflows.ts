import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { logger } from "@/lib/logger";

import { workflowProposalSpec } from "../../lib/proposal-specs";
import {
  WEEKDAYS,
  WORKFLOW_CADENCES,
  runTimeSchema,
} from "../../workflows/schema";
import { WorkflowLimitError, createWorkflow } from "../../workflows/store";
import { defineAiProposal } from "../propose";

export const proposeAiWorkflow = defineAiProposal({
  name: "proposeAiWorkflow",
  domain: "general",
  permission: "ai:chat",
  sources: ["ai_workflows"],
  description:
    "Propose a recurring AI task (tarea programada) for the user to confirm on a card: " +
    "the assistant will run the request on a schedule with the user's read-only " +
    "permissions and leave the result in Tareas IA. Use it when the user asks for " +
    'something periodic ("todos los lunes resumime cobranzas vencidas"). Times are ' +
    "Buenos Aires local time on a 15-minute grid. Writes nothing by itself.",
  input: z.object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Short name, in Spanish (e.g. 'Cobranzas vencidas semanal')."),
    prompt: z
      .string()
      .trim()
      .min(10)
      .max(2000)
      .describe(
        "What each run must do, in Spanish, self-contained (it runs with nobody to ask).",
      ),
    cadence: z.enum(WORKFLOW_CADENCES),
    runTime: runTimeSchema.describe(
      "HH:MM in Buenos Aires time, minutes 00/15/30/45. Default 08:00.",
    ),
    weekday: z
      .enum(WEEKDAYS)
      .optional()
      .describe("Weekly only: ISO weekday, '1' = lunes … '7' = domingo."),
    monthDay: z
      .number()
      .int()
      .min(1)
      .max(28)
      .optional()
      .describe("Monthly only: day of the month, 1 to 28."),
  }),
  spec: workflowProposalSpec,
  prepare: async (_ctx, input) => ({
    kind: "draft",
    draft: {
      title: input.title,
      prompt: input.prompt,
      cadence: input.cadence,
      runTime: input.runTime,
      weekday: input.weekday ?? null,
      monthDay: input.monthDay ?? null,
    },
  }),
  execute: async (ctx, draft) => {
    try {
      const created = await createWorkflow(ctx.userId, draft);
      await logAudit(
        "ai.workflow.created",
        ctx.userId,
        { cadence: draft.cadence, origin: "assistant" },
        created.id,
      );
      return { ok: true, data: created };
    } catch (error) {
      if (error instanceof WorkflowLimitError) {
        return { ok: false, error: error.message };
      }
      logger.error("ai.workflows.create_failed", {
        userId: ctx.userId,
        error,
      });
      return { ok: false, error: "No se pudo crear la tarea." };
    }
  },
});
