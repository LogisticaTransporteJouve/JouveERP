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
  const pending = {
    id: "c2",
    action: "proposeExchangeRate",
    revision: 2,
    status: "pending",
  };

  it("supersedes the key's pending revision by id, then inserts the next one", async () => {
    responses.push(
      { data: pending, error: null },
      { data: [{ id: "c2" }], error: null },
      { data: { id: "c3", revision: 3 }, error: null },
    );
    const res = await createConfirmationRevision(
      "u1",
      "s1",
      input,
      "assistant",
    );
    expect(res).toEqual({ id: "c3", revision: 3 });
    expect(calls[1]).toMatchObject({
      op: "update",
      payload: { status: "superseded" },
    });
    expect(calls[1]?.filters).toEqual([
      ["user_id", "u1"],
      ["id", "c2"],
      ["action", "proposeExchangeRate"],
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

  it("inserts without superseding when the key's latest revision is decided", async () => {
    responses.push(
      { data: { ...pending, status: "confirmed" }, error: null },
      { data: { id: "c3", revision: 3 }, error: null },
    );
    await createConfirmationRevision("u1", "s1", input, "assistant");
    expect(calls.map((c) => c.op)).toEqual(["select", "insert"]);
  });

  it("refuses a re-proposal when a confirm claimed the pending revision first", async () => {
    responses.push({ data: pending, error: null }, { data: [], error: null });
    await expect(
      createConfirmationRevision("u1", "s1", input, "assistant"),
    ).rejects.toBeInstanceOf(ConcurrentRevisionError);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("refuses a user edit of a revision that is no longer pending (no reopening)", async () => {
    // The edited row is still the latest, but a confirm moved it out of pending.
    responses.push(
      { data: { ...pending, status: "confirmed" }, error: null },
      { data: [], error: null },
    );
    await expect(
      createConfirmationRevision("u1", "s1", input, "user", "c2"),
    ).rejects.toBeInstanceOf(ConcurrentRevisionError);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("refuses a user edit of a revision that a newer one replaced", async () => {
    responses.push({
      data: { ...pending, id: "c5", revision: 5 },
      error: null,
    });
    await expect(
      createConfirmationRevision("u1", "s1", input, "user", "c2"),
    ).rejects.toBeInstanceOf(ConcurrentRevisionError);
    expect(calls).toHaveLength(1);
  });

  it("refuses a revisionKey that belongs to another action", async () => {
    responses.push({
      data: { ...pending, action: "proposeLeave" },
      error: null,
    });
    await expect(
      createConfirmationRevision("u1", "s1", input, "assistant"),
    ).rejects.toBeInstanceOf(RevisionKeyMismatchError);
    expect(calls).toHaveLength(1);
  });

  it("reports a lost race on the one-pending index as a concurrent revision", async () => {
    responses.push(
      { data: null, error: null },
      { data: null, error: { code: "23505", message: "duplicate" } },
    );
    await expect(
      createConfirmationRevision("u1", "s1", input, "assistant"),
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
