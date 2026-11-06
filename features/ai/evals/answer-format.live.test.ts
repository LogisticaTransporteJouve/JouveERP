import { generateText, isStepCount, type ToolSet } from "ai";
import { describe, expect, it } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import { buildSystemPrompt } from "../agent";
import { RENDER_TOOLS } from "../artifacts/spec";
import { buildChatModel } from "../model";
import {
  AI_ACTIONS,
  buildAiTools,
  buildCapabilitiesSummary,
} from "../registry";
import { buildSkillsBlock } from "../skills/registry";

// Live answer-format eval: the comparison that once came back as markdown
// tables in the chat. With every read stubbed to a small IVA result, the
// answer must send its tables to the panel (a render tool), keep the text
// free of markdown tables and never name a tool. Opt-in and paid, like
// routing.live.test.ts: `pnpm eval:ai` with ANTHROPIC_API_KEY.

const LIVE =
  process.env.AI_EVALS_LIVE === "1" && !!process.env.ANTHROPIC_API_KEY;

const QUESTION = "IVA ventas vs compras septiembre 2026";

const META = {
  sources: ["libro_iva"],
  asOf: "2026-10-01T12:00:00Z",
  partial: false,
};

function stubbedTools(): ToolSet {
  const access = resolveAccess(["owner"]);
  const real = buildAiTools(
    {
      userId: "eval",
      access,
      proposals: {
        createRevision: async () => ({ id: "conf-1", revision: 1 }),
      },
      artifacts: { emit: () => true },
    },
    AI_ACTIONS,
  );
  const tools: ToolSet = {};
  for (const [name, t] of Object.entries(real)) {
    tools[name] = {
      ...t,
      execute: async () =>
        RENDER_TOOLS.includes(name)
          ? { ok: true, summary: "Shown to the user.", data: null, meta: META }
          : {
              ok: true,
              summary: "Solo fiscal. Septiembre 2026.",
              data: {
                rows: [
                  { alicuota: "21%", neto: 10_000_000, iva: 2_100_000 },
                  { alicuota: "10,5%", neto: 1_000_000, iva: 105_000 },
                ],
              },
              meta: META,
            },
    };
  }
  return tools;
}

describe.skipIf(!LIVE)("AI CFO answer format (live model)", () => {
  it(
    QUESTION,
    async () => {
      const skills = buildSkillsBlock(QUESTION);
      const { model } = buildChatModel();
      const result = await generateText({
        model,
        instructions: [
          {
            role: "system",
            content: buildSystemPrompt(
              buildCapabilitiesSummary(resolveAccess(["owner"]), undefined, {
                artifacts: true,
              }),
            ),
          },
          ...(skills ? [{ role: "system" as const, content: skills }] : []),
        ],
        prompt: QUESTION,
        tools: stubbedTools(),
        stopWhen: isStepCount(6),
        maxOutputTokens: 4_000,
        providerOptions: { anthropic: { effort: "low" } },
      });
      const called = result.steps.flatMap((s) =>
        s.toolCalls.map((c) => c.toolName),
      );
      expect(
        called.some((n) => RENDER_TOOLS.includes(n)),
        called.join(),
      ).toBe(true);
      expect(result.text).not.toMatch(/^\s*\|.*\|\s*$/m);
      for (const name of [...AI_ACTIONS.map((a) => a.name), ...RENDER_TOOLS]) {
        expect(result.text).not.toMatch(new RegExp(`\\b${name}\\b`));
      }
    },
    180_000,
  );
});
