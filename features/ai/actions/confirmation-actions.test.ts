import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/lib/auth/permissions";

import type { AiConfirmation } from "../lib/confirmation-schema";

let roles: Role[] = ["finance"];
const getConfirmation = vi.fn();
const claimConfirmation = vi.fn();
const recordConfirmationOutcome = vi.fn();
const createConfirmationRevision = vi.fn();
const logAudit = vi.fn();
const createLeave = vi.fn();
const upsertManualExchangeRate = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", roles }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));
vi.mock("@/lib/commands/create-leave", () => ({ createLeave }));
vi.mock("@/lib/commands/upsert-exchange-rate", () => ({
  upsertManualExchangeRate,
}));
vi.mock("../lib/confirmations", () => ({
  getConfirmation,
  claimConfirmation,
  recordConfirmationOutcome,
  createConfirmationRevision,
  listSessionConfirmations: vi.fn(),
  ConcurrentRevisionError: class extends Error {},
}));

const {
  confirmAiProposalAction,
  declineAiProposalAction,
  reviseAiProposalAction,
} = await import("./confirmation-actions");

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMP = "11111111-1111-4111-8111-111111111111";

const leaveDraft = {
  employee_id: EMP,
  start_date: "2026-11-02",
  end_date: "2026-11-06",
  kind: "vacaciones",
  notes: null,
};

const leaveRow: AiConfirmation = {
  id: ID,
  session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  tool_call_id: "call-1",
  action: "proposeLeave",
  revision_key: "k1",
  revision: 1,
  origin: "assistant",
  draft: leaveDraft,
  labels: { [EMP]: "Ana Pérez" },
  summary: [],
  status: "pending",
  result_id: null,
  error: null,
  created_at: "2026-10-16T12:00:00Z",
  decided_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  roles = ["finance"];
  getConfirmation.mockResolvedValue(leaveRow);
  claimConfirmation.mockResolvedValue({ ...leaveRow, status: "confirmed" });
  createLeave.mockResolvedValue({ ok: true, data: { id: "leave-1" } });
});

describe("confirmAiProposalAction", () => {
  it("runs the write once for a role that holds the proposal's permissions", async () => {
    const res = await confirmAiProposalAction(ID);
    expect(res).toEqual({ ok: true, data: { resultId: "leave-1" } });
    expect(claimConfirmation).toHaveBeenCalledWith("u1", ID, "confirmed");
    expect(createLeave).toHaveBeenCalledTimes(1);
    expect(recordConfirmationOutcome).toHaveBeenCalledWith("u1", ID, {
      resultId: "leave-1",
    });
    expect(logAudit).toHaveBeenCalledWith(
      "ai.proposal.confirmed",
      "u1",
      expect.objectContaining({ action: "proposeLeave", result_id: "leave-1" }),
      ID,
    );
  });

  it("refuses a role without the write permission before claiming", async () => {
    roles = ["operations"];
    const res = await confirmAiProposalAction(ID);
    expect(res).toMatchObject({ ok: false });
    expect(claimConfirmation).not.toHaveBeenCalled();
    expect(createLeave).not.toHaveBeenCalled();
  });

  it("refuses a role without ai:chat", async () => {
    roles = ["warehouse"];
    expect(await confirmAiProposalAction(ID)).toMatchObject({ ok: false });
    expect(getConfirmation).not.toHaveBeenCalled();
  });

  it("does nothing when another confirm already claimed the row", async () => {
    claimConfirmation.mockResolvedValue(null);
    const res = await confirmAiProposalAction(ID);
    expect(res).toMatchObject({ ok: false });
    expect(createLeave).not.toHaveBeenCalled();
    expect(recordConfirmationOutcome).not.toHaveBeenCalled();
  });

  it("refuses a decided, foreign or missing row", async () => {
    getConfirmation.mockResolvedValue({ ...leaveRow, status: "superseded" });
    expect(await confirmAiProposalAction(ID)).toMatchObject({ ok: false });
    getConfirmation.mockResolvedValue(null);
    expect(await confirmAiProposalAction(ID)).toMatchObject({ ok: false });
    expect(await confirmAiProposalAction("not-a-uuid")).toMatchObject({
      ok: false,
    });
    expect(claimConfirmation).not.toHaveBeenCalled();
  });

  it("re-validates the stored draft before claiming it", async () => {
    getConfirmation.mockResolvedValue({
      ...leaveRow,
      draft: { ...leaveDraft, end_date: "2026-10-01" },
    });
    expect(await confirmAiProposalAction(ID)).toMatchObject({ ok: false });
    expect(claimConfirmation).not.toHaveBeenCalled();
  });

  it("records a failed write as the revision's outcome", async () => {
    createLeave.mockResolvedValue({ ok: false, error: "boom" });
    const res = await confirmAiProposalAction(ID);
    expect(res).toEqual({ ok: false, error: "boom" });
    expect(recordConfirmationOutcome).toHaveBeenCalledWith("u1", ID, {
      error: "boom",
    });
  });
});

describe("declineAiProposalAction", () => {
  it("declines through the compare-and-set and audits it", async () => {
    claimConfirmation.mockResolvedValue({ ...leaveRow, status: "declined" });
    expect(await declineAiProposalAction(ID)).toEqual({
      ok: true,
      data: undefined,
    });
    expect(claimConfirmation).toHaveBeenCalledWith("u1", ID, "declined");
    expect(logAudit).toHaveBeenCalledWith(
      "ai.proposal.declined",
      "u1",
      expect.any(Object),
      ID,
    );
  });
});

describe("reviseAiProposalAction", () => {
  it("stores the edit as the card's next revision, keeping non-editable fields", async () => {
    createConfirmationRevision.mockResolvedValue({ id: "c2", revision: 2 });
    getConfirmation.mockResolvedValueOnce(leaveRow).mockResolvedValueOnce({
      ...leaveRow,
      id: "c2",
      revision: 2,
      origin: "user",
    });
    const res = await reviseAiProposalAction(ID, {
      end_date: "2026-11-09",
      employee_id: "44444444-4444-4444-8444-444444444444",
    });
    expect(res).toMatchObject({ ok: true, data: { revision: 2 } });
    expect(createConfirmationRevision).toHaveBeenCalledWith(
      "u1",
      leaveRow.session_id,
      expect.objectContaining({
        toolCallId: "call-1",
        revisionKey: "k1",
        draft: expect.objectContaining({
          employee_id: EMP,
          end_date: "2026-11-09",
        }),
      }),
      "user",
    );
  });

  it("rejects an edit the form's schema rejects", async () => {
    const res = await reviseAiProposalAction(ID, { end_date: "2026-10-01" });
    expect(res).toMatchObject({ ok: false });
    expect(createConfirmationRevision).not.toHaveBeenCalled();
  });

  it("refuses a role without the proposal's permissions", async () => {
    roles = ["operations"];
    expect(await reviseAiProposalAction(ID, {})).toMatchObject({ ok: false });
    expect(createConfirmationRevision).not.toHaveBeenCalled();
  });
});
