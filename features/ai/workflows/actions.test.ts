import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
const store = {
  listWorkflows: vi.fn(async () => []),
  createWorkflow: vi.fn<
    (userId: string, draft: unknown) => Promise<{ id: string }>
  >(async () => ({
    id: "w1",
  })),
  setWorkflowActive: vi.fn(async () => true),
  deleteWorkflow: vi.fn(async () => true),
  listRuns: vi.fn(async () => []),
};
const logAudit = vi.fn(async () => undefined);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "me",
    access: resolveAccess(roles),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));
vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  ...store,
}));

const actions = await import("./actions");

const WF = "3f0c9a9e-5a51-4c55-9b0e-0b7d1c1c2a10";
const draft = {
  title: "Cobranzas",
  prompt: "Resumime las cobranzas vencidas.",
  cadence: "weekly",
  runTime: "08:00",
  weekday: "1",
  monthDay: null,
};

beforeEach(() => {
  roles = ["finance"];
  for (const fn of Object.values(store)) fn.mockClear();
  logAudit.mockClear();
});

describe("AI task actions", () => {
  it("refuse every role without ai:chat before touching the store", async () => {
    for (const role of ["warehouse", "driver"] as const) {
      roles = [role];
      const results = await Promise.all([
        actions.listAiWorkflowsAction(),
        actions.createAiWorkflowAction(draft),
        actions.setAiWorkflowActiveAction({ id: WF, active: false }),
        actions.deleteAiWorkflowAction({ id: WF }),
        actions.listAiWorkflowRunsAction({ id: WF }),
      ]);
      for (const res of results) expect(res.ok).toBe(false);
    }
    for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled();
  });

  it("scope every store call to the caller's own user id", async () => {
    await actions.listAiWorkflowsAction();
    await actions.createAiWorkflowAction(draft);
    await actions.setAiWorkflowActiveAction({ id: WF, active: true });
    await actions.deleteAiWorkflowAction({ id: WF });
    await actions.listAiWorkflowRunsAction({ id: WF });
    expect(store.listWorkflows).toHaveBeenCalledWith("me");
    expect(store.createWorkflow.mock.calls[0]?.[0]).toBe("me");
    expect(store.setWorkflowActive).toHaveBeenCalledWith("me", WF, true);
    expect(store.deleteWorkflow).toHaveBeenCalledWith("me", WF);
    expect(store.listRuns).toHaveBeenCalledWith("me", WF);
  });

  it("validates the draft with the shared schema", async () => {
    const res = await actions.createAiWorkflowAction({
      ...draft,
      runTime: "08:07",
    });
    expect(res.ok).toBe(false);
    expect(store.createWorkflow).not.toHaveBeenCalled();
  });

  it("reports another user's task as not found", async () => {
    store.deleteWorkflow.mockResolvedValueOnce(false);
    const res = await actions.deleteAiWorkflowAction({ id: WF });
    expect(res).toEqual({ ok: false, error: "No se encontró la tarea." });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
