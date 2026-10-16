import "server-only";

import {
  generateText,
  isStepCount,
  tool,
  type SystemModelMessage,
  type ToolSet,
} from "ai";
import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import type { HeadlessUser } from "@/lib/auth/headless-user";

import {
  AI_MAX_STEPS,
  CACHE_BREAKPOINT,
  toJsonValue,
  withTailCacheBreakpoint,
} from "../agent";
import { buildHeadlessSystemPrompt, headlessReadActions } from "../headless";
import { usageTokens, type AiUsageTokens } from "../lib/chat-store";
import { AI_CHAT_MAX_OUTPUT_TOKENS, buildChatModel } from "../model";
import { splitRunOutput, type RunMemory } from "./memory";
import { loadEarlierRunOutput } from "./memory-store";

export const OPEN_EARLIER_RUN_TOOL = "openEarlierRun";

export const RUN_OUTPUT_RULES = `Formato de salida: respondé en markdown. Al final agregá una última línea que empiece con "RESUMEN:" y tenga hasta 300 caracteres con los hallazgos y cifras clave: es lo que vas a recordar en la próxima corrida.`;

export type WorkflowAgentInput = {
  user: HeadlessUser;
  runId: string;
  workflow: { id: string; title: string; prompt: string };
  /** Buenos Aires date of the occurrence (YYYY-MM-DD). */
  runDate: string;
  memory: RunMemory | null;
};

export type WorkflowAgentResult = {
  output: string;
  summary: string;
  toolNames: string[];
  /** Tool calls made, and how many returned data (`ok: true`). */
  reads: { calls: number; ok: number };
  usage: AiUsageTokens;
  model: string;
};

function isOkResult(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    Reflect.get(output, "ok") === true
  );
}

/** True when the run tried to read and every read failed: its answer can
 *  only say so, and must not be reported as a finished result. */
export function allReadsFailed(reads: { calls: number; ok: number }): boolean {
  return reads.calls > 0 && reads.ok === 0;
}

/** Reads an earlier run of the same task, only among the runs the memory
 *  block listed (owner and workflow are fixed by the caller, not the model). */
export function openEarlierRunTool(
  userId: string,
  workflowId: string,
  openable: ReadonlySet<string>,
) {
  return tool({
    description:
      "Abre el resultado completo de una corrida anterior de esta misma tarea, por su id (de la memoria de la tarea).",
    inputSchema: z.object({ runId: z.uuid() }),
    execute: async ({ runId }) => {
      if (!openable.has(runId)) {
        return {
          ok: false,
          error: "Esa corrida no está en la memoria de esta tarea.",
        };
      }
      const run = await loadEarlierRunOutput(userId, workflowId, runId);
      if (!run) return { ok: false, error: "No se encontró esa corrida." };
      return { ok: true, data: run };
    },
  });
}

/** The tools a run gets: the user's read actions, plus `openEarlierRun` when
 *  there is something to remember. Never a proposal or the question card. */
export function buildWorkflowTools(
  input: Pick<WorkflowAgentInput, "user" | "workflow" | "memory">,
): ToolSet {
  const ctx = { userId: input.user.userId, roles: input.user.roles };
  const tools: ToolSet = {};
  for (const action of headlessReadActions(input.user.roles)) {
    tools[action.name] = action.toTool(ctx);
  }
  if (input.memory) {
    tools[OPEN_EARLIER_RUN_TOOL] = openEarlierRunTool(
      input.user.userId,
      input.workflow.id,
      input.memory.openableRunIds,
    );
  }
  return tools;
}

/**
 * Runs one occurrence of a scheduled task: the CFO agent with the user's read
 * tools, the task's prompt as the user turn and the memory of earlier runs.
 * Must be called inside `runAsHeadlessUser` so the read actions query as the
 * user. Tool calls are audited as `ai-agent` acting for the user.
 */
export async function runWorkflowAgent(
  input: WorkflowAgentInput,
): Promise<WorkflowAgentResult> {
  const tools = buildWorkflowTools(input);
  const instructions: SystemModelMessage[] = [
    {
      role: "system",
      content: `${buildHeadlessSystemPrompt(input.user.roles)}\n\n${RUN_OUTPUT_RULES}`,
      providerOptions: CACHE_BREAKPOINT,
    },
  ];
  if (input.memory) {
    instructions.push({ role: "system", content: input.memory.block });
  }
  const { model, servedModel } = buildChatModel();
  const result = await generateText({
    model,
    instructions,
    messages: [
      {
        role: "user",
        content: `Tarea programada "${input.workflow.title}" (corrida del ${input.runDate}):\n${input.workflow.prompt}`,
      },
    ],
    tools,
    stopWhen: isStepCount(AI_MAX_STEPS),
    maxOutputTokens: AI_CHAT_MAX_OUTPUT_TOKENS,
    providerOptions: { anthropic: { effort: "medium" } },
    // Same caching as the chat: the static prompt and tools, plus the history
    // tail each step, so the tool loop re-reads its prefix from cache.
    prepareStep: ({ initialMessages, responseMessages }) => ({
      messages: withTailCacheBreakpoint([
        ...initialMessages,
        ...responseMessages,
      ]),
    }),
    onStepEnd: async ({ toolCalls }) => {
      for (const call of toolCalls) {
        await logAudit(
          "ai.tool_call",
          input.user.userId,
          {
            tool: call.toolName,
            tool_call_id: call.toolCallId,
            input: toJsonValue(call.input),
            workflow_run_id: input.runId,
          },
          input.runId,
          { actorType: "ai-agent" },
        );
      }
    },
  });
  const toolNames = Array.from(
    new Set(result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName))),
  );
  const reads = {
    calls: result.steps.reduce((n, s) => n + s.toolCalls.length, 0),
    ok: result.steps
      .flatMap((s) => s.toolResults)
      .filter((r) => isOkResult(r.output)).length,
  };
  const { output, summary } = splitRunOutput(result.text);
  return {
    output: output || "La corrida no devolvió texto.",
    summary,
    toolNames,
    reads,
    usage: usageTokens(result.totalUsage),
    model: servedModel(),
  };
}
