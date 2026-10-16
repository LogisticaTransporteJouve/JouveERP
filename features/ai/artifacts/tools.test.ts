import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Role } from "@/lib/auth/permissions";

import { buildAiTools, buildCapabilitiesSummary } from "../registry/build";
import { defineAiAction } from "../registry/define";
import { okResult } from "../registry/result";

import { runArtifact } from "./run";
import { createArtifactSink } from "./sink";
import {
  buildArtifactTools,
  RENDER_CHART_TOOL,
  RENDER_TABLE_TOOL,
} from "./tools";

const expenseRun = vi.fn(async (_ctx: unknown, input: { period: string }) =>
  okResult(`rows for ${input.period}`, [
    { category: "Combustible", total: "1500" },
    { category: "Peajes", total: "300" },
  ]),
);

const getExpenses = defineAiAction({
  name: "getExpenses",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["ai_expense_by_category"],
  description: "Expenses by category.",
  input: z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }),
  run: expenseRun,
});

const getPayroll = defineAiAction({
  name: "getPayroll",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["ai_payroll_summary"],
  description: "Payroll.",
  input: z.object({}),
  run: async () => okResult("rows", [{ month: "2026-05", total: 1 }]),
});

const proposeThing = defineAiAction({
  name: "proposeThing",
  domain: "general",
  permission: "accounting:read",
  sideEffect: "propose",
  sources: ["x"],
  description: "Not a read.",
  input: z.object({}),
  run: async () => okResult("rows", [{ a: "x", b: 1 }]),
});

const ACTIONS = [getExpenses, getPayroll, proposeThing];
const ctx = (roles: Role[]) => ({ userId: "u1", roles });
const call = { toolCallId: "call-1", messages: [], context: undefined };

describe("runArtifact", () => {
  it("runs the source query as the user and builds from its rows", async () => {
    const run = await runArtifact(
      ctx(["finance"]),
      {
        kind: "chart",
        source: { action: "getExpenses", input: { period: "2026-05" } },
        config: { type: "bar", title: "Gastos" },
      },
      ACTIONS,
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.input).toEqual({ period: "2026-05" });
    expect(run.artifact.kind === "chart" && run.artifact.points).toEqual([
      { x: "Combustible", values: [1500] },
      { x: "Peajes", values: [300] },
    ]);
    expect(run.artifact.meta.sources).toEqual(["ai_expense_by_category"]);
  });

  it("refuses a query the role cannot run, before running it", async () => {
    const run = await runArtifact(
      ctx(["operations"]),
      {
        kind: "table",
        source: { action: "getPayroll", input: {} },
        config: { title: "Sueldos" },
      },
      ACTIONS,
    );
    expect(run).toMatchObject({ ok: false, denied: true });
  });

  it("refuses a non-read action and an unknown name", async () => {
    for (const action of ["proposeThing", "renderChart", "nope"]) {
      const run = await runArtifact(
        ctx(["owner"]),
        {
          kind: "table",
          source: { action, input: {} },
          config: { title: "T" },
        },
        ACTIONS,
      );
      expect(run).toMatchObject({ ok: false, denied: true });
    }
  });

  it("validates the input with the query's own schema", async () => {
    expenseRun.mockClear();
    const run = await runArtifact(
      ctx(["finance"]),
      {
        kind: "table",
        source: { action: "getExpenses", input: { period: "mayo" } },
        config: { title: "T" },
      },
      ACTIONS,
    );
    expect(run).toMatchObject({ ok: false, denied: false });
    expect(expenseRun).not.toHaveBeenCalled();
  });
});

describe("artifact tools", () => {
  it("emit the artifact as a data part and give the model a summary with provenance", async () => {
    const emit = vi.fn(() => true);
    const tools = buildArtifactTools(ctx(["finance"]), { emit }, ACTIONS);
    const execute = tools[RENDER_CHART_TOOL]?.execute;
    expect(execute).toBeDefined();
    const out = await execute?.(
      {
        action: "getExpenses",
        input: { period: "2026-05" },
        chart: { type: "hbar", title: "Gastos" },
      },
      call,
    );
    expect(emit).toHaveBeenCalledWith(
      "call-1",
      expect.objectContaining({ kind: "chart", title: "Gastos" }),
    );
    expect(out).toMatchObject({
      ok: true,
      meta: { sources: ["ai_expense_by_category"], partial: false },
    });
  });

  it("emit nothing when the build fails", async () => {
    const emit = vi.fn(() => true);
    const tools = buildArtifactTools(ctx(["finance"]), { emit }, ACTIONS);
    const out = await tools[RENDER_TABLE_TOOL]?.execute?.(
      {
        action: "getExpenses",
        input: { period: "2026-05" },
        table: { title: "T", columns: [{ field: "missing" }] },
      },
      call,
    );
    expect(out).toMatchObject({ ok: false });
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("buildAiTools", () => {
  it("offers the artifact tools only with a sink and a read query", () => {
    const sink = { emit: vi.fn(() => true) };
    expect(
      Object.keys(
        buildAiTools({ ...ctx(["finance"]), artifacts: sink }, ACTIONS),
      ),
    ).toEqual(expect.arrayContaining([RENDER_CHART_TOOL, RENDER_TABLE_TOOL]));
    expect(Object.keys(buildAiTools(ctx(["finance"]), ACTIONS))).not.toContain(
      RENDER_CHART_TOOL,
    );
    expect(
      Object.keys(
        buildAiTools({ ...ctx(["driver"]), artifacts: sink }, ACTIONS),
      ),
    ).not.toContain(RENDER_TABLE_TOOL);
  });

  it("lists them in the capabilities summary when asked", () => {
    expect(
      buildCapabilitiesSummary(["finance"], ACTIONS, { artifacts: true }),
    ).toContain(RENDER_CHART_TOOL);
    expect(buildCapabilitiesSummary(["finance"], ACTIONS)).not.toContain(
      RENDER_CHART_TOOL,
    );
  });
});

describe("createArtifactSink", () => {
  it("writes artifacts while the turn's byte budget lasts", async () => {
    const run = await runArtifact(
      ctx(["finance"]),
      {
        kind: "table",
        source: { action: "getExpenses", input: { period: "2026-05" } },
        config: { title: "Gastos" },
      },
      ACTIONS,
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const size = JSON.stringify(run.artifact).length;
    const sink = createArtifactSink(size * 2);
    const write = vi.fn();
    expect(sink.emit("a", run.artifact)).toBe(false);
    sink.attach(write);
    expect(sink.emit("a", run.artifact)).toBe(true);
    expect(sink.emit("b", run.artifact)).toBe(true);
    expect(sink.emit("c", run.artifact)).toBe(false);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith({
      type: "data-artifact",
      id: "a",
      data: run.artifact,
    });
  });
});
