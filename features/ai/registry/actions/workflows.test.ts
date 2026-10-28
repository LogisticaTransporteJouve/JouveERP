import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

import type { AiProposalStore } from "../define";

const createWorkflow = vi.fn<
  (userId: string, draft: unknown) => Promise<{ id: string }>
>(async () => ({
  id: "w1",
}));
const logAudit = vi.fn(async () => undefined);

vi.mock("../../workflows/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../workflows/store")>()),
  createWorkflow,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));

const { proposeAiWorkflow } = await import("./workflows");

const call = { toolCallId: "call-1" };
const store = (): AiProposalStore & {
  createRevision: ReturnType<typeof vi.fn>;
} => ({ createRevision: vi.fn(async () => ({ id: "conf-1", revision: 1 })) });
const ctx = (roles: Role[], proposals?: AiProposalStore) => ({
  userId: "u1",
  access: resolveAccess(roles),
  ...(proposals ? { proposals } : {}),
});

const input = {
  title: "Cobranzas vencidas",
  prompt: "Resumime las cobranzas vencidas por cliente.",
  cadence: "weekly",
  runTime: "08:00",
  weekday: "1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("proposeAiWorkflow", () => {
  it("drafts a weekly task for confirmation and writes nothing", async () => {
    const s = store();
    const res = await proposeAiWorkflow.execute(
      ctx(["operations"], s),
      input,
      call,
    );
    expect(res.ok).toBe(true);
    expect(s.createRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "proposeAiWorkflow",
        draft: expect.objectContaining({ weekday: "1", monthDay: null }),
        summary: expect.arrayContaining([
          {
            label: "Cuándo",
            value: "Todos los lunes a las 08:00 (hora de Buenos Aires)",
          },
        ]),
      }),
    );
    expect(createWorkflow).not.toHaveBeenCalled();
  });

  it("asks for the missing weekday instead of guessing", async () => {
    const s = store();
    const res = await proposeAiWorkflow.execute(
      ctx(["finance"], s),
      { ...input, weekday: undefined },
      call,
    );
    expect(res.ok && res.data).toMatchObject({
      requiresConfirmation: false,
      issues: [expect.objectContaining({ field: "weekday" })],
    });
    expect(s.createRevision).not.toHaveBeenCalled();
  });

  it("refuses roles without ai:chat", async () => {
    const s = store();
    const res = await proposeAiWorkflow.execute(
      ctx(["warehouse"], s),
      input,
      call,
    );
    expect(res.ok).toBe(false);
    expect(s.createRevision).not.toHaveBeenCalled();
  });

  it("creates the task for the confirming user on confirm", async () => {
    const res = await proposeAiWorkflow.proposal?.executeDraft(
      ctx(["finance"]),
      {
        ...input,
        monthDay: null,
      },
    );
    expect(res).toEqual({ ok: true, data: { id: "w1" } });
    expect(createWorkflow.mock.calls[0]?.[0]).toBe("u1");
    expect(logAudit).toHaveBeenCalledWith(
      "ai.workflow.created",
      "u1",
      { cadence: "weekly", origin: "assistant" },
      "w1",
    );
  });
});
