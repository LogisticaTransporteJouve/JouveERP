import { generateText, isStepCount } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DENIED_CASES, ROUTING_CASES, inputMatches } from "./routing-cases";
import { scriptedModel, textTurn, toolCallTurn } from "./scripted-model";
import { resolveAccess } from "@/lib/auth/permissions";

// Offline routing eval: no network, no model. For each case the scripted model
// makes the expected call; the suite checks that the asking role is offered
// that tool, that the call passes the tool's own input schema and permission
// gate, and that it reaches the gated server action with the right arguments.
// What the real model would pick is the live suite's job.

const denied = { ok: false, error: "eval" };
const dispatched: Record<string, ReturnType<typeof vi.fn>> = {};
function stub(name: string) {
  const fn = vi.fn(async () => denied);
  dispatched[name] = fn;
  return fn;
}

vi.mock("@/features/hr/actions/hr-reports-actions", async (orig) => ({
  ...(await orig<typeof import("@/features/hr/actions/hr-reports-actions")>()),
  getPayrollSummaryAction: stub("getPayrollSummaryAction"),
  getDriverExtrasAction: stub("getDriverExtrasAction"),
  getVacationOverviewAction: stub("getVacationOverviewAction"),
}));
vi.mock(
  "@/features/suppliers/actions/purchases-report-actions",
  async (orig) => ({
    ...(await orig<
      typeof import("@/features/suppliers/actions/purchases-report-actions")
    >()),
    getSupplierPurchasesSummaryAction: stub(
      "getSupplierPurchasesSummaryAction",
    ),
  }),
);
vi.mock("@/features/fleet-reports/actions/margin-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/fleet-reports/actions/margin-actions")
  >()),
  getFleetMarginAction: stub("getFleetMarginAction"),
}));
vi.mock("@/features/aging/actions/aging-actions", async (orig) => ({
  ...(await orig<typeof import("@/features/aging/actions/aging-actions")>()),
  getAgingSummaryAction: stub("getAgingSummaryAction"),
}));
vi.mock("@/features/treasury/actions/treasury-actions", async (orig) => ({
  ...(await orig<
    typeof import("@/features/treasury/actions/treasury-actions")
  >()),
  getTreasurySummaryAction: stub("getTreasurySummaryAction"),
}));

const { buildAiTools, buildCapabilitiesSummary } = await import("../registry");

const proposals = {
  createRevision: vi.fn(async () => ({ id: "conf-1", revision: 1 })),
};

beforeEach(() => {
  for (const fn of Object.values(dispatched)) fn.mockClear();
  proposals.createRevision.mockClear();
});

describe("AI CFO tool routing (offline)", () => {
  it.each(ROUTING_CASES)("$id: $question", async (c) => {
    const tools = buildAiTools({
      userId: "u1",
      access: resolveAccess(c.roles),
      proposals,
    });
    expect(Object.keys(tools), "offered to the role").toContain(c.expect.tool);
    expect(buildCapabilitiesSummary(resolveAccess(c.roles))).toContain(
      `- ${c.expect.tool}`,
    );

    const model = scriptedModel([
      toolCallTurn(c.expect.tool, c.scriptedInput ?? c.expect.input),
      textTurn("ok"),
    ]);
    const result = await generateText({
      model,
      prompt: c.question,
      tools,
      stopWhen: isStepCount(2),
    });
    const call = result.steps[0]?.toolCalls[0];
    expect(call?.toolName).toBe(c.expect.tool);
    expect(inputMatches(call?.input, c.expect.input)).toBe(true);
    const toolResult = result.steps[0]?.toolResults[0];
    expect(toolResult, "the tool ran (input passed its schema)").toBeDefined();

    if (c.dispatch) {
      const fn = dispatched[c.dispatch.fn];
      expect(fn).toHaveBeenCalledOnce();
      if (Object.keys(c.dispatch.args).length > 0) {
        expect(fn).toHaveBeenCalledWith(
          expect.objectContaining(c.dispatch.args),
        );
      }
    } else {
      expect(proposals.createRevision).toHaveBeenCalledOnce();
    }
  });

  it.each(DENIED_CASES)("$id: never offers $forbiddenTools", (c) => {
    const tools = Object.keys(
      buildAiTools({ userId: "u1", access: resolveAccess(c.roles) }),
    );
    const summary = buildCapabilitiesSummary(resolveAccess(c.roles));
    for (const name of c.forbiddenTools) {
      expect(tools).not.toContain(name);
      expect(summary).not.toContain(`- ${name}:`);
    }
  });

  it("matches inputs field by field", () => {
    expect(inputMatches({ a: 1, b: 2 }, { a: 1 })).toBe(true);
    expect(inputMatches({ a: 1 }, { a: 2 })).toBe(false);
    expect(inputMatches(null, {})).toBe(false);
  });
});
