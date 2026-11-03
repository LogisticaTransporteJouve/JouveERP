import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

import type { AiProposalRow } from "../lib/ai-proposal-schema";

const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
let roles: Role[] = ["finance"];
const getProposal = vi.fn();
const claimProposal = vi.fn();
const recordProposalOutcome = vi.fn();
const insertProposal = vi.fn();
const latestProposalByKey = vi.fn();
const failStaleAcceptedProposal = vi.fn();
const logAudit = vi.fn();
const createTask = vi.fn();
const issueLateInterestNd = vi.fn();
let insight: Record<string, unknown> | null = null;

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: USER,
    access: resolveAccess(roles),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));
vi.mock("@/lib/commands/create-task", () => ({ createTask }));
vi.mock("@/lib/commands/issue-late-interest-nd", () => ({
  issueLateInterestNd,
}));
vi.mock("@/lib/supabase/server", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: insight, error: null }),
  };
  return { createClient: async () => ({ from: () => chain }) };
});
vi.mock("../lib/ai-proposals", () => ({
  getProposal,
  claimProposal,
  recordProposalOutcome,
  insertProposal,
  latestProposalByKey,
  failStaleAcceptedProposal,
  proposalDedupeKey: (action: string) => `${action}:key`,
}));

const {
  acceptAiProposalAction,
  dismissAiProposalAction,
  prepareInsightProposalAction,
} = await import("./proposal-actions");

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INSIGHT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const taskRow: AiProposalRow = {
  id: ID,
  action: "proposeTask",
  source: "insight",
  insight_id: INSIGHT,
  insight_kind: "loan_installments_due",
  dedupe_key: "proposeTask:key",
  draft: {
    title: "Pagar la cuota 1",
    description: null,
    due_date: "2026-11-10",
    assignee_ids: [],
  },
  labels: {},
  summary: [],
  title: "Crear tarea",
  status: "pending",
  result: null,
  error: null,
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  created_at: "2026-11-03T12:00:00Z",
  decided_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  roles = ["finance"];
  getProposal.mockResolvedValue(taskRow);
  claimProposal.mockResolvedValue({ ...taskRow, status: "accepted" });
  createTask.mockResolvedValue({ ok: true, data: { id: "task-1" } });
  latestProposalByKey.mockResolvedValue(null);
  insertProposal.mockImplementation(async (_u: string, p: unknown) => ({
    ...taskRow,
    ...(p as object),
  }));
  insight = {
    id: INSIGHT,
    kind: "loan_installments_due",
    status: "open",
    proposal: {
      action: "proposeTask",
      label: "Crear tarea de pago",
      input: { title: "Pagar la cuota 1", due_date: "2026-11-10" },
    },
  };
});

describe("acceptAiProposalAction", () => {
  it("claims, runs the write once and audits it", async () => {
    const res = await acceptAiProposalAction(ID);
    expect(res).toEqual({
      ok: true,
      data: { resultId: "task-1", note: null },
    });
    expect(claimProposal).toHaveBeenCalledWith(USER, ID, "accepted");
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(recordProposalOutcome).toHaveBeenCalledWith(USER, ID, {
      result: { id: "task-1" },
    });
    expect(logAudit).toHaveBeenCalledWith(
      "ai.proposal.accepted",
      USER,
      expect.objectContaining({ action: "proposeTask", result_id: "task-1" }),
      ID,
    );
  });

  it("does not write when another click claimed it first", async () => {
    claimProposal.mockResolvedValue(null);
    const res = await acceptAiProposalAction(ID);
    expect(res.ok).toBe(false);
    expect(createTask).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses a role without the action's permissions before claiming", async () => {
    roles = ["operations"];
    getProposal.mockResolvedValue({
      ...taskRow,
      action: "proposeLateInterestNd",
    });
    const res = await acceptAiProposalAction(ID);
    expect(res).toEqual({
      ok: false,
      error: "No tenés permiso para esta acción.",
    });
    expect(claimProposal).not.toHaveBeenCalled();
    expect(issueLateInterestNd).not.toHaveBeenCalled();
  });

  it("closes an expired proposal instead of running it", async () => {
    getProposal.mockResolvedValue({
      ...taskRow,
      expires_at: "2026-01-01T00:00:00Z",
    });
    const res = await acceptAiProposalAction(ID);
    expect(res.ok).toBe(false);
    expect(claimProposal).toHaveBeenCalledWith(USER, ID, "expired");
    expect(createTask).not.toHaveBeenCalled();
  });

  it("re-validates the stored draft with the form's schema", async () => {
    getProposal.mockResolvedValue({ ...taskRow, draft: { title: "" } });
    const res = await acceptAiProposalAction(ID);
    expect(res.ok).toBe(false);
    expect(claimProposal).not.toHaveBeenCalled();
  });

  it("records a failed write and audits it as failed", async () => {
    createTask.mockResolvedValue({ ok: false, error: "boom" });
    const res = await acceptAiProposalAction(ID);
    expect(res).toEqual({ ok: false, error: "boom" });
    expect(recordProposalOutcome).toHaveBeenCalledWith(USER, ID, {
      error: "boom",
    });
    expect(logAudit).toHaveBeenCalledWith(
      "ai.proposal.failed",
      USER,
      expect.anything(),
      ID,
    );
  });

  it("refuses a user without ai:read", async () => {
    roles = ["warehouse"];
    expect((await acceptAiProposalAction(ID)).ok).toBe(false);
    expect(getProposal).not.toHaveBeenCalled();
  });
});

describe("dismissAiProposalAction", () => {
  it("claims the row as dismissed and audits it", async () => {
    claimProposal.mockResolvedValue({ ...taskRow, status: "dismissed" });
    expect(await dismissAiProposalAction(ID)).toEqual({
      ok: true,
      data: undefined,
    });
    expect(claimProposal).toHaveBeenCalledWith(USER, ID, "dismissed");
    expect(logAudit).toHaveBeenCalledWith(
      "ai.proposal.dismissed",
      USER,
      expect.objectContaining({ action: "proposeTask" }),
      ID,
    );
  });
});

describe("prepareInsightProposalAction", () => {
  it("drafts the insight's proposal as the caller, assigned to them", async () => {
    const res = await prepareInsightProposalAction(INSIGHT);
    expect(res.ok).toBe(true);
    const [, stored] = insertProposal.mock.calls[0] ?? [];
    expect(stored).toMatchObject({
      action: "proposeTask",
      insightId: INSIGHT,
      dedupeKey: "proposeTask:key",
      draft: {
        title: "Pagar la cuota 1",
        due_date: "2026-11-10",
        assignee_ids: [USER],
      },
    });
  });

  it("returns the pending proposal of a second click instead of a new one", async () => {
    latestProposalByKey.mockResolvedValue(taskRow);
    const res = await prepareInsightProposalAction(INSIGHT);
    expect(res.ok && res.data.id).toBe(ID);
    expect(insertProposal).not.toHaveBeenCalled();
  });

  it("hides an insight of a domain the caller cannot read", async () => {
    roles = ["operations"];
    const res = await prepareInsightProposalAction(INSIGHT);
    expect(res).toEqual({ ok: false, error: "No se encontró el insight." });
    expect(insertProposal).not.toHaveBeenCalled();
  });

  it("returns an accepted proposal whose write may still be running", async () => {
    latestProposalByKey.mockResolvedValue({
      ...taskRow,
      status: "accepted",
      decided_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await prepareInsightProposalAction(INSIGHT);
    expect(res.ok && res.data.status).toBe("accepted");
    expect(failStaleAcceptedProposal).not.toHaveBeenCalled();
    expect(insertProposal).not.toHaveBeenCalled();
  });

  it("closes an accepted proposal left without outcome and shows its warning first", async () => {
    latestProposalByKey.mockResolvedValue({
      ...taskRow,
      status: "accepted",
      decided_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
    failStaleAcceptedProposal.mockResolvedValue(true);
    const res = await prepareInsightProposalAction(INSIGHT);
    expect(failStaleAcceptedProposal).toHaveBeenCalledWith(
      USER,
      ID,
      expect.any(String),
      expect.stringContaining("No se sabe si la acción se completó"),
    );
    expect(logAudit).toHaveBeenCalledWith(
      "ai.proposal.failed",
      USER,
      expect.objectContaining({ result_id: null }),
      ID,
    );
    // The unknown outcome is shown before a new proposal is offered.
    expect(insertProposal).not.toHaveBeenCalled();
    expect(res.ok && res.data).toMatchObject({
      id: ID,
      status: "failed",
      error: expect.stringContaining("No se sabe si la acción se completó"),
    });
  });

  it("prepares a new proposal on the next open after the warning", async () => {
    latestProposalByKey.mockResolvedValue({
      ...taskRow,
      status: "failed",
      error: "No se sabe si la acción se completó.",
      decided_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
    const res = await prepareInsightProposalAction(INSIGHT);
    expect(insertProposal).toHaveBeenCalledTimes(1);
    expect(res.ok && res.data.status).toBe("pending");
  });

  it("shows the row as another request left it when the close loses the race", async () => {
    latestProposalByKey.mockResolvedValue({
      ...taskRow,
      status: "accepted",
      decided_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
    failStaleAcceptedProposal.mockResolvedValue(false);
    getProposal.mockResolvedValue({
      ...taskRow,
      status: "accepted",
      result: { id: "task-1" },
    });
    const res = await prepareInsightProposalAction(INSIGHT);
    expect(insertProposal).not.toHaveBeenCalled();
    expect(res.ok && res.data.status).toBe("accepted");
  });

  it("keeps showing an accepted proposal that recorded its result", async () => {
    latestProposalByKey.mockResolvedValue({
      ...taskRow,
      status: "accepted",
      result: { id: "task-1" },
      decided_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
    const res = await prepareInsightProposalAction(INSIGHT);
    expect(res.ok && res.data.status).toBe("accepted");
    expect(failStaleAcceptedProposal).not.toHaveBeenCalled();
  });
});
