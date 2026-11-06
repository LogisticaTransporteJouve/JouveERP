import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiConfirmation } from "./confirmation-schema";

/** One recorded PostgREST call: the operation and every filter applied. */
type Call = { op: string; payload?: unknown; filters: [string, unknown][] };
type Response = { data: unknown; error: unknown };

const calls: Call[] = [];
const responses: Response[] = [];
const rpcCalls: { fn: string; args: unknown }[] = [];

function builder(): Record<string, unknown> {
  const call: Call = { op: "select", filters: [] };
  calls.push(call);
  const respond = async () => responses.shift() ?? { data: null, error: null };
  const b: Record<string, unknown> = {
    update: (payload: unknown) => {
      call.op = "update";
      call.payload = payload;
      return b;
    },
    insert: (payload: unknown) => {
      call.op = "insert";
      call.payload = payload;
      return b;
    },
    select: () => b,
    eq: (col: string, value: unknown) => {
      call.filters.push([col, value]);
      return b;
    },
    order: () => b,
    limit: () => b,
    maybeSingle: respond,
    single: respond,
    then: (resolve: (r: Response) => unknown) => respond().then(resolve),
  };
  return b;
}

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    from: () => builder(),
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return responses.shift() ?? { data: null, error: null };
    },
  }),
}));

const {
  claimConfirmation,
  ConcurrentRevisionError,
  createConfirmationRevision,
  proposalStatusNote,
  RevisionKeyMismatchError,
} = await import("./confirmations");

const ROW: AiConfirmation = {
  id: "c1",
  session_id: "s1",
  tool_call_id: "call-1",
  action: "proposeExchangeRate",
  revision_key: "k1",
  revision: 1,
  origin: "assistant",
  draft: { rate_date: "2026-10-16", rate: 1200 },
  labels: {},
  summary: [{ label: "Fecha", value: "16 oct 2026" }],
  status: "confirmed",
  result_id: null,
  result_note: null,
  error: null,
  created_at: "2026-10-16T12:00:00Z",
  decided_at: "2026-10-16T12:01:00Z",
};

const input = {
  toolCallId: "call-2",
  action: "proposeExchangeRate",
  revisionKey: "k1",
  draft: { rate_date: "2026-10-16", rate: 1250 },
  labels: {},
  summary: [],
};

beforeEach(() => {
  calls.length = 0;
  responses.length = 0;
  rpcCalls.length = 0;
});

describe("claimConfirmation (compare-and-set)", () => {
  it("moves the row only while it is pending, and only the caller's", async () => {
    responses.push({ data: ROW, error: null });
    const row = await claimConfirmation("u1", "c1", "confirmed");
    expect(row?.id).toBe("c1");
    expect(calls[0]).toMatchObject({
      op: "update",
      payload: { status: "confirmed" },
    });
    expect(calls[0]?.filters).toEqual([
      ["user_id", "u1"],
      ["id", "c1"],
      ["status", "pending"],
    ]);
  });

  it("returns null to the second confirm: the row is no longer pending", async () => {
    responses.push({ data: ROW, error: null }, { data: null, error: null });
    expect(await claimConfirmation("u1", "c1", "confirmed")).not.toBeNull();
    expect(await claimConfirmation("u1", "c1", "confirmed")).toBeNull();
  });
});

// The supersede-then-insert rules run in create_ai_confirmation_revision
// (supabase/tests/ai_confirmation_revision_test.sql); here, what the caller
// sends and how it reads the refusals.
describe("createConfirmationRevision", () => {
  it("stores the revision and its supersede in one call", async () => {
    responses.push({ data: [{ id: "c3", revision: 3 }], error: null });
    const res = await createConfirmationRevision(
      "u1",
      "s1",
      input,
      "user",
      "c2",
    );
    expect(res).toEqual({ id: "c3", revision: 3 });
    expect(calls).toHaveLength(0);
    expect(rpcCalls).toEqual([
      {
        fn: "create_ai_confirmation_revision",
        args: {
          p_user_id: "u1",
          p_session_id: "s1",
          p_tool_call_id: "call-2",
          p_action: "proposeExchangeRate",
          p_revision_key: "k1",
          p_origin: "user",
          p_draft: input.draft,
          p_labels: {},
          p_summary: [],
          p_replaces: "c2",
        },
      },
    ]);
  });

  it("refuses when another decision got to the replaced revision first", async () => {
    responses.push({
      data: null,
      error: { code: "P0001", hint: "ai_revision_concurrent", message: "x" },
    });
    await expect(
      createConfirmationRevision("u1", "s1", input, "user", "c2"),
    ).rejects.toBeInstanceOf(ConcurrentRevisionError);
  });

  it("refuses a revisionKey that belongs to another action", async () => {
    responses.push({
      data: null,
      error: { code: "P0001", hint: "ai_revision_key_mismatch", message: "x" },
    });
    await expect(
      createConfirmationRevision("u1", "s1", input, "assistant"),
    ).rejects.toBeInstanceOf(RevisionKeyMismatchError);
  });

  it("reports a lost race on the one-pending index as a concurrent revision", async () => {
    responses.push({
      data: null,
      error: { code: "23505", message: "duplicate" },
    });
    await expect(
      createConfirmationRevision("u1", "s1", input, "assistant"),
    ).rejects.toBeInstanceOf(ConcurrentRevisionError);
  });

  it("throws any other failure as it came", async () => {
    const error = { code: "XX000", message: "boom" };
    responses.push({ data: null, error });
    await expect(
      createConfirmationRevision("u1", "s1", input, "assistant"),
    ).rejects.toBe(error);
  });
});

describe("proposalStatusNote", () => {
  it("states the latest revision of each proposal", () => {
    const note = proposalStatusNote([
      { ...ROW, status: "superseded", revision: 1, origin: "assistant" },
      {
        ...ROW,
        id: "c2",
        status: "confirmed",
        revision: 2,
        origin: "user",
        result_id: "r9",
        result_note: "2 conciliadas.",
      },
      { ...ROW, id: "c4", revision_key: "k2", status: "declined" },
    ]);
    expect(note).toContain("revisionKey k1, revision 2): confirmada");
    expect(note).toContain("el usuario editó el borrador");
    expect(note).toContain("id creado r9");
    expect(note).toContain("resultado: 2 conciliadas.");
    expect(note).toContain("revisionKey k2, revision 1): descartada");
    expect(note).not.toContain("revision 1): reemplazada");
  });

  it("is empty without proposals", () => {
    expect(proposalStatusNote([])).toBe("");
  });
});
