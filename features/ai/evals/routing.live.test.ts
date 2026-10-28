import { generateText, isStepCount, type ToolSet } from "ai";
import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../agent";
import { buildChatModel } from "../model";
import {
  AI_ACTIONS,
  buildAiTools,
  buildCapabilitiesSummary,
} from "../registry";
import { buildSkillsBlock } from "../skills/registry";
import { ROUTING_CASES, inputMatches } from "./routing-cases";
import { resolveAccess } from "@/lib/auth/permissions";

// Live routing eval: asks the real model (Anthropic, plus any configured
// fallback) each case's question with the role's real tool list and checks
// the first tool it calls. Tools never execute: each returns a stub, so no
// database is touched. Opt-in and paid: `pnpm eval:ai` with ANTHROPIC_API_KEY.

const LIVE =
  process.env.AI_EVALS_LIVE === "1" && !!process.env.ANTHROPIC_API_KEY;

const proposals = {
  createRevision: async () => ({ id: "conf-1", revision: 1 }),
};

/** The role's real tools (schemas and descriptions) with stub executors. */
function stubbedTools(access: Parameters<typeof buildAiTools>[0]["access"]) {
  const real = buildAiTools({ userId: "eval", access, proposals }, AI_ACTIONS);
  const tools: ToolSet = {};
  for (const [name, t] of Object.entries(real)) {
    tools[name] = {
      ...t,
      execute: async () => ({ ok: true, summary: "eval stub", data: null }),
    };
  }
  return tools;
}

describe.skipIf(!LIVE)("AI CFO tool routing (live model)", () => {
  it.each(ROUTING_CASES)(
    "$id: $question",
    async (c) => {
      const skills = buildSkillsBlock(c.question);
      const { model } = buildChatModel();
      const result = await generateText({
        model,
        instructions: [
          {
            role: "system",
            content: buildSystemPrompt(
              buildCapabilitiesSummary(resolveAccess(c.roles)),
            ),
          },
          ...(skills ? [{ role: "system" as const, content: skills }] : []),
        ],
        prompt: c.question,
        tools: stubbedTools(resolveAccess(c.roles)),
        stopWhen: isStepCount(1),
        maxOutputTokens: 4_000,
        providerOptions: { anthropic: { effort: "low" } },
      });
      const call = result.steps[0]?.toolCalls[0];
      expect(call?.toolName, JSON.stringify(call)).toBe(c.expect.tool);
      expect(
        inputMatches(call?.input, c.expect.input),
        JSON.stringify(call?.input),
      ).toBe(true);
    },
    120_000,
  );
});
