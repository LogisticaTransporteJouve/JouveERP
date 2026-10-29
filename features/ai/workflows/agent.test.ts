import { beforeEach, describe, expect, it, vi } from "vitest";

import { aggregateClientAging } from "@/lib/aging";

import {
  offeredTools,
  scriptedModel,
  textTurn,
  toolCallTurn,
} from "../evals/scripted-model";
import { resolveAccess } from "@/lib/auth/permissions";

let model = scriptedModel([]);
const logAudit = vi.fn(async () => undefined);
const getAgingSummaryAction = vi.fn();
const loadEarlierRunOutput = vi.fn();

vi.mock("../model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model")>()),
  buildChatModel: () => ({
    model,
    servedModel: () => "claude-sonnet-5-5",
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));
vi.mock("@/features/aging/actions/aging-actions", () => ({
  getAgingSummaryAction,
}));
vi.mock("./memory-store", () => ({ loadEarlierRunOutput }));

const {
  OPEN_EARLIER_RUN_TOOL,
  allReadsFailed,
  buildWorkflowTools,
  openEarlierRunTool,
  runWorkflowAgent,
} = await import("./agent");
const { renderRunMemory } = await import("./memory");

const finance = {
  userId: "u1",
  email: "a@b.c",
  access: resolveAccess(["finance"]),
};
const workflow = {
  id: "w1",
  title: "Cobranzas",
  prompt: "Resumime las cobranzas vencidas.",
};
const PREV = "11111111-1111-4111-8111-111111111111";
const memory = renderRunMemory(
  { id: PREV, scheduledFor: "2026-10-12T11:00:00Z", summary: "s", output: "o" },
  [],
);

beforeEach(() => {
  logAudit.mockClear();
  getAgingSummaryAction.mockReset();
  loadEarlierRunOutput.mockReset();
});

describe("buildWorkflowTools", () => {
  it("offers only read actions: no proposals and no question card", () => {
    const names = Object.keys(
      buildWorkflowTools({
        user: { ...finance, access: resolveAccess(["owner"]) },
        workflow,
        memory: null,
      }),
    );
    expect(names).toContain("getClientAging");
    expect(names).not.toContain("askQuestions");
    expect(names.some((n) => n.startsWith("propose"))).toBe(false);
    expect(names).not.toContain(OPEN_EARLIER_RUN_TOOL);
    expect(names).not.toContain("renderChart");
    expect(names).not.toContain("renderTable");
  });

  it("follows the user's roles at run time", () => {
    const ops = Object.keys(
      buildWorkflowTools({
        user: { ...finance, access: resolveAccess(["operations"]) },
        workflow,
        memory: null,
      }),
    );
    expect(ops).not.toContain("getPayrollSummary");
    expect(ops).not.toContain("getTreasurySummary");
  });

  it("adds openEarlierRun when there is memory", () => {
    expect(
      Object.keys(buildWorkflowTools({ user: finance, workflow, memory })),
    ).toContain(OPEN_EARLIER_RUN_TOOL);
  });
});

describe("openEarlierRun", () => {
  it("refuses a run the memory did not list, without reading", async () => {
    const t = openEarlierRunTool("u1", "w1", new Set([PREV]));
    const res = await t.execute?.(
      { runId: "22222222-2222-4222-8222-222222222222" },
      { toolCallId: "c", messages: [], context: {} },
    );
    expect(res).toMatchObject({ ok: false });
    expect(loadEarlierRunOutput).not.toHaveBeenCalled();
  });

  it("reads a listed run with the owner and task fixed by the caller", async () => {
    loadEarlierRunOutput.mockResolvedValue({
      id: PREV,
      scheduledFor: "x",
      output: "o",
    });
    const t = openEarlierRunTool("u1", "w1", new Set([PREV]));
    await t.execute?.(
      { runId: PREV },
      { toolCallId: "c", messages: [], context: {} },
    );
    expect(loadEarlierRunOutput).toHaveBeenCalledWith("u1", "w1", PREV);
  });
});

describe("runWorkflowAgent", () => {
  it("runs the tool loop, audits each call and splits answer and summary", async () => {
    getAgingSummaryAction.mockResolvedValue({
      ok: true,
      data: aggregateClientAging([], null),
    });
    model = scriptedModel([
      toolCallTurn("getClientAging", {}),
      textTurn(
        "## Cobranzas\n3 clientes deben $ 1.000.\nRESUMEN: 3 clientes, $ 1.000 abiertos.",
      ),
    ]);
    const res = await runWorkflowAgent({
      user: finance,
      runId: "r1",
      workflow,
      runDate: "2026-10-19",
      memory,
    });
    expect(res).toMatchObject({
      output: "## Cobranzas\n3 clientes deben $ 1.000.",
      summary: "3 clientes, $ 1.000 abiertos.",
      toolNames: ["getClientAging"],
      reads: { calls: 1, ok: 1 },
      model: "claude-sonnet-5-5",
    });
    expect(res.usage.inputTokens).toBe(2_000);
    expect(logAudit).toHaveBeenCalledWith(
      "ai.tool_call",
      "u1",
      expect.objectContaining({
        tool: "getClientAging",
        workflow_run_id: "r1",
      }),
      "r1",
      { actorType: "ai-agent" },
    );
    const offered = offeredTools(model);
    expect(offered).toContain(OPEN_EARLIER_RUN_TOOL);
    expect(offered).not.toContain("askQuestions");
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("Esta corrida es automática");
    expect(prompt).toContain(PREV);
  });
});

describe("allReadsFailed", () => {
  it("is true only when the run read something and nothing came back", () => {
    expect(allReadsFailed({ calls: 2, ok: 0 })).toBe(true);
    expect(allReadsFailed({ calls: 2, ok: 1 })).toBe(false);
    expect(allReadsFailed({ calls: 0, ok: 0 })).toBe(false);
  });
});
