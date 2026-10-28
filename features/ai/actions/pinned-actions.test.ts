import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
const listPins = vi.fn();
const getPin = vi.fn();
const insertPin = vi.fn();
const deletePin = vi.fn();
const logAudit = vi.fn();
const sueldosRun = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));
vi.mock("../lib/pinned-artifacts", () => ({
  listPins,
  getPin,
  insertPin,
  deletePin,
}));
vi.mock("../registry/catalog", async () => {
  const { defineAiAction } = await import("../registry/define");
  const { okResult } = await import("../registry/result");
  return {
    AI_ACTIONS: [
      defineAiAction({
        name: "getPayrollSummary",
        domain: "rrhh",
        permission: "hr:read",
        sideEffect: "read",
        sources: ["ai_payroll_summary"],
        description: "Payroll totals.",
        input: z.object({
          from: z.string().regex(/^\d{4}-\d{2}$/),
          extra: z.string().optional(),
        }),
        run: async (_ctx, input) => {
          sueldosRun(input);
          return okResult("rows", [
            { month: "2026-04", total_net: "100" },
            { month: "2026-05", total_net: "120" },
          ]);
        },
      }),
    ],
  };
});

const {
  listAiPinnedArtifactsAction,
  loadAiPinnedArtifactAction,
  pinAiArtifactAction,
  unpinAiArtifactAction,
} = await import("./pinned-actions");

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const chartRequest = {
  kind: "chart",
  source: { action: "getPayrollSummary", input: { from: "2026-04" } },
  config: { type: "line", title: "Sueldos netos" },
};

const storedPin = {
  id: ID,
  kind: "chart",
  title: "Sueldos netos",
  action: "getPayrollSummary",
  createdAt: "2026-10-16T12:00:00Z",
  request: {
    kind: "chart",
    source: { action: "getPayrollSummary", input: { from: "2026-04" } },
    config: {
      type: "line",
      title: "Sueldos netos",
      x: "month",
      xLabel: "Month",
      series: [{ field: "total_net", label: "Total net" }],
      sort: "none",
      valueFormat: "money",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  roles = ["finance"];
  insertPin.mockResolvedValue({ ok: true, id: ID });
  deletePin.mockResolvedValue(true);
  getPin.mockResolvedValue(storedPin);
  listPins.mockResolvedValue([storedPin]);
});

describe("pinAiArtifactAction", () => {
  it("re-runs the query and stores the source, parsed input and resolved config — no rows", async () => {
    const res = await pinAiArtifactAction(chartRequest);
    expect(res).toEqual({ ok: true, data: { id: ID } });
    expect(sueldosRun).toHaveBeenCalledWith({ from: "2026-04" });
    expect(insertPin).toHaveBeenCalledWith("u1", storedPin.request);
    const stored = JSON.stringify(insertPin.mock.calls[0]?.[1]);
    expect(stored).not.toContain("120");
    expect(logAudit).toHaveBeenCalledWith(
      "ai.artifact.pinned",
      "u1",
      { kind: "chart", action: "getPayrollSummary" },
      ID,
    );
  });

  it("ignores rows the client sends", async () => {
    const res = await pinAiArtifactAction({
      ...chartRequest,
      points: [{ x: "2026-05", values: [999999] }],
    });
    expect(res).toMatchObject({ ok: false });
    expect(insertPin).not.toHaveBeenCalled();
  });

  it("refuses a role without ai:chat", async () => {
    roles = ["warehouse"];
    expect(await pinAiArtifactAction(chartRequest)).toMatchObject({
      ok: false,
    });
    expect(sueldosRun).not.toHaveBeenCalled();
    expect(insertPin).not.toHaveBeenCalled();
  });

  it("refuses a chat role without the query's permission", async () => {
    roles = ["operations"];
    expect(await pinAiArtifactAction(chartRequest)).toEqual({
      ok: false,
      error: "No tenés permiso para esta consulta.",
    });
    expect(sueldosRun).not.toHaveBeenCalled();
    expect(insertPin).not.toHaveBeenCalled();
  });

  it("reports the per-user cap and a duplicate the database refused", async () => {
    insertPin.mockResolvedValue({ ok: false, reason: "limit" });
    expect(await pinAiArtifactAction(chartRequest)).toMatchObject({
      ok: false,
      error: expect.stringContaining("hasta 30"),
    });
    insertPin.mockResolvedValue({ ok: false, reason: "duplicate" });
    expect(await pinAiArtifactAction(chartRequest)).toEqual({
      ok: false,
      error: "Ya lo tenías fijado.",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("unpinAiArtifactAction", () => {
  it("deletes only the caller's pin", async () => {
    expect(await unpinAiArtifactAction(ID)).toEqual({
      ok: true,
      data: undefined,
    });
    expect(deletePin).toHaveBeenCalledWith("u1", ID);
    expect(logAudit).toHaveBeenCalledWith("ai.artifact.unpinned", "u1", {}, ID);
  });

  it("reports a missing or foreign pin and refuses without ai:chat", async () => {
    deletePin.mockResolvedValue(false);
    expect(await unpinAiArtifactAction(ID)).toMatchObject({ ok: false });
    expect(await unpinAiArtifactAction("nope")).toMatchObject({ ok: false });
    roles = ["driver"];
    deletePin.mockClear();
    expect(await unpinAiArtifactAction(ID)).toMatchObject({ ok: false });
    expect(deletePin).not.toHaveBeenCalled();
  });
});

describe("loadAiPinnedArtifactAction", () => {
  it("recomputes the pin with the current data", async () => {
    const res = await loadAiPinnedArtifactAction(ID);
    expect(getPin).toHaveBeenCalledWith("u1", ID);
    expect(sueldosRun).toHaveBeenCalledTimes(1);
    expect(res.ok && res.data.status).toBe("ok");
    if (
      res.ok &&
      res.data.status === "ok" &&
      res.data.artifact.kind === "chart"
    ) {
      expect(res.data.artifact.points.at(-1)).toEqual({
        x: "2026-05",
        values: [120],
      });
    }
  });

  it("returns no data once the viewer lost the query's permission", async () => {
    roles = ["operations"];
    const res = await loadAiPinnedArtifactAction(ID);
    expect(res).toEqual({ ok: true, data: { status: "denied" } });
    expect(sueldosRun).not.toHaveBeenCalled();
  });

  it("refuses a missing pin and a role without ai:chat", async () => {
    getPin.mockResolvedValue(null);
    expect(await loadAiPinnedArtifactAction(ID)).toMatchObject({ ok: false });
    roles = ["warehouse"];
    expect(await listAiPinnedArtifactsAction()).toMatchObject({ ok: false });
    expect(listPins).not.toHaveBeenCalled();
  });
});
