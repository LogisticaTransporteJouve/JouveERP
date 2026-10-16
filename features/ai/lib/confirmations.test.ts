import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiConfirmation } from "./confirmation-schema";

/** One recorded PostgREST call: the operation and every filter applied. */
type Call = { op: string; payload?: unknown; filters: [string, unknown][] };
type Response = { data: unknown; error: unknown };

const calls: Call[] = [];
const responses: Response[] = [];

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
  getServiceClient: () => ({ from: () => builder() }),
}));

const {
  claimConfirmation,
  ConcurrentRevisionError,
  createConfirmationRevision,
  proposalStatusNote,
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

describe("createConfirmationRevision", () => {
  it("supersedes the pending revision of the same key, then inserts the next one", async () => {
    responses.push(
      { data: null, error: null },
      { data: { revision: 2 }, error: null },
      { data: { id: "c3", revision: 3 }, error: null },
    );
    const res = await createConfirmationRevision(
      "u1",
      "s1",
      input,
      "assistant",
    );
    expect(res).toEqual({ id: "c3", revision: 3 });
    expect(calls[0]).toMatchObject({
      op: "update",
      payload: { status: "superseded" },
    });
    expect(calls[0]?.filters).toEqual([
      ["user_id", "u1"],
      ["session_id", "s1"],
      ["revision_key", "k1"],
      ["status", "pending"],
    ]);
    expect(calls[2]).toMatchObject({
      op: "insert",
      payload: {
        user_id: "u1",
        session_id: "s1",
        revision: 3,
        origin: "assistant",
      },
    });
  });

  it("reports a lost race on the one-pending index as a concurrent revision", async () => {
    responses.push(
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: { code: "23505", message: "duplicate" } },
    );
    await expect(
      createConfirmationRevision("u1", "s1", input, "user"),
    ).rejects.toBeInstanceOf(ConcurrentRevisionError);
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
      },
      { ...ROW, id: "c4", revision_key: "k2", status: "declined" },
    ]);
    expect(note).toContain("revisionKey k1, revision 2): confirmada");
    expect(note).toContain("el usuario editó el borrador");
    expect(note).toContain("id creado r9");
    expect(note).toContain("revisionKey k2, revision 1): descartada");
    expect(note).not.toContain("revision 1): reemplazada");
  });

  it("is empty without proposals", () => {
    expect(proposalStatusNote([])).toBe("");
  });
});
