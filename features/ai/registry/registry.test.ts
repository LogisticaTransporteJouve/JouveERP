import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  PERMISSIONS,
  ROLES,
  type Role,
  resolveAccess,
} from "@/lib/auth/permissions";

const getPayrollSummaryAction = vi.fn();

vi.mock("@/features/hr/actions/hr-reports-actions", () => ({
  getPayrollSummaryAction,
  getPayrollConceptsAction: vi.fn(),
  getDriverExtrasAction: vi.fn(),
  getVacationOverviewAction: vi.fn(),
  getLeavesSummaryAction: vi.fn(),
  getAttendanceSummaryAction: vi.fn(),
}));

const { AI_ACTIONS } = await import("./catalog");
const { buildAiTools, buildCapabilitiesSummary, visibleAiActions } =
  await import("./build");
const { defineAiAction } = await import("./define");
const { getPayrollSummary } = await import("./actions/payroll");

const PAYROLL_TOOLS = [
  "getPayrollSummary",
  "getPayrollConcepts",
  "getDriverExtras",
  "getVacationOverview",
  "getLeavesSummary",
  "getAttendanceSummary",
  "getPayrollPeriods",
  "getEmployees",
];

const ctx = (roles: Role[]) => ({ userId: "u1", access: resolveAccess(roles) });

beforeEach(() => {
  getPayrollSummaryAction.mockReset();
});

describe("registry catalogue", () => {
  it("has unique names, known permissions, sources and read or propose effects", () => {
    const names = AI_ACTIONS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const action of AI_ACTIONS) {
      expect(
        action.permissions.length + action.anyOfPermissions.length,
        action.name,
      ).toBeGreaterThan(0);
      for (const p of [...action.permissions, ...action.anyOfPermissions]) {
        expect(PERMISSIONS, `${action.name}: ${p}`).toContain(p);
      }
      expect(action.sources.length, action.name).toBeGreaterThan(0);
      expect(["read", "propose"], action.name).toContain(action.sideEffect);
      // A proposal carries its card spec and executor; a read never does.
      expect(Boolean(action.proposal), action.name).toBe(
        action.sideEffect === "propose",
      );
    }
  });

  it("gives owner and admin every action", () => {
    expect(visibleAiActions(resolveAccess(["owner"]))).toHaveLength(
      AI_ACTIONS.length,
    );
    expect(visibleAiActions(resolveAccess(["admin"]))).toHaveLength(
      AI_ACTIONS.length,
    );
  });

  it("shows each role exactly the actions whose permissions it holds, plus the question card", () => {
    for (const role of ROLES) {
      const tools = Object.keys(buildAiTools(ctx([role])));
      const expected = [
        "askQuestions",
        ...visibleAiActions(resolveAccess([role])).map((a) => a.name),
      ];
      expect(tools.sort()).toEqual(expected.sort());
    }
  });
});

describe("per-user denies", () => {
  it("hides every action that needs a permission of a denied module", () => {
    const gated = AI_ACTIONS.filter((a) =>
      a.permissions.some((p) => p.startsWith("invoices:")),
    ).map((a) => a.name);
    expect(gated.length).toBeGreaterThan(0);
    const names = visibleAiActions(
      resolveAccess(["admin"], ["invoices:read"]),
    ).map((a) => a.name);
    expect(names).toHaveLength(AI_ACTIONS.length - gated.length);
    for (const name of gated) expect(names).not.toContain(name);
  });
});

describe("searchGlobal gate", () => {
  const visible = (access: ReturnType<typeof resolveAccess>) =>
    visibleAiActions(access).some((a) => a.name === "searchGlobal");

  it("needs any one of the searchable entities' read permissions", () => {
    expect(visible(resolveAccess(["finance"], ["clients:read"]))).toBe(true);
    expect(visible(resolveAccess(["warehouse"]))).toBe(false);
  });
});

describe("payroll isolation", () => {
  it("exposes payroll tools to finance (hr:read)", () => {
    const tools = buildAiTools(ctx(["finance"]));
    for (const name of PAYROLL_TOOLS) expect(tools, name).toHaveProperty(name);
  });

  it("never exposes payroll tools, nor lists them, to roles without hr:read", () => {
    for (const role of ["operations", "warehouse", "driver"] as const) {
      const tools = buildAiTools(ctx([role]));
      const summary = buildCapabilitiesSummary(resolveAccess([role]));
      for (const name of PAYROLL_TOOLS) {
        expect(tools, `${role}: ${name}`).not.toHaveProperty(name);
        expect(summary, `${role}: ${name}`).not.toContain(name);
      }
      expect(summary).not.toContain("RRHH y sueldos");
    }
  });

  it("refuses to run a payroll action for a role without hr:read", async () => {
    const res = await getPayrollSummary.execute(ctx(["operations"]), {
      fromPeriod: "2026-01",
      toPeriod: "2026-03",
    });
    expect(res.ok).toBe(false);
    expect(getPayrollSummaryAction).not.toHaveBeenCalled();
  });

  it("refuses through the tool bound to an unprivileged context too", async () => {
    const tool = getPayrollSummary.toTool(ctx(["operations"]));
    const res = await tool.execute?.(
      { fromPeriod: "2026-01", toPeriod: "2026-03" },
      { toolCallId: "t1", messages: [], context: {} },
    );
    expect(res).toMatchObject({ ok: false });
    expect(getPayrollSummaryAction).not.toHaveBeenCalled();
  });
});

describe("capabilities summary", () => {
  it("lists one line per visible action, grouped by domain", () => {
    const summary = buildCapabilitiesSummary(resolveAccess(["operations"]));
    expect(summary).toContain("Flota y transporte:");
    expect(summary).toContain("- getFleetMargin: Margen de flota");
    const lines = summary.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(
      visibleAiActions(resolveAccess(["operations"])).length,
    );
  });

  it("says so when a role has no action", () => {
    expect(buildCapabilitiesSummary(resolveAccess([]))).toContain(
      "Sin consultas",
    );
  });
});

describe("defineAiAction execute", () => {
  const run = vi.fn();
  const probe = defineAiAction({
    name: "probe",
    domain: "general",
    description: "Probe. Second sentence.",
    input: z.object({ n: z.number() }),
    output: z.object({ total: z.number() }),
    permission: ["accounting:read"],
    sideEffect: "read",
    sources: ["probe_rpc"],
    run,
  });

  beforeEach(() => run.mockReset());

  it("adds provenance to a successful result", async () => {
    run.mockResolvedValue({
      ok: true,
      summary: "ok",
      data: { total: 3 },
      partial: true,
      currency: "ARS",
    });
    const res = await probe.execute(ctx(["finance"]), { n: 1 });
    expect(run).toHaveBeenCalledWith(ctx(["finance"]), { n: 1 });
    expect(res).toMatchObject({
      ok: true,
      data: { total: 3 },
      meta: { sources: ["probe_rpc"], partial: true, currency: "ARS" },
    });
    if (res.ok) expect(Number.isNaN(Date.parse(res.meta.asOf))).toBe(false);
  });

  it("rejects invalid model input without running", async () => {
    const res = await probe.execute(ctx(["finance"]), { n: "1" });
    expect(res.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("turns a thrown run or an output mismatch into an error result", async () => {
    run.mockRejectedValueOnce(new Error("db down"));
    expect((await probe.execute(ctx(["finance"]), { n: 1 })).ok).toBe(false);
    run.mockResolvedValueOnce({ ok: true, summary: "x", data: { total: "3" } });
    expect((await probe.execute(ctx(["finance"]), { n: 1 })).ok).toBe(false);
  });
});
