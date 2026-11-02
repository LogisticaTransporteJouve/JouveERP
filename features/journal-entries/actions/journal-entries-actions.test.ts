import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Access, type Role } from "@/lib/auth/permissions";
import {
  filterValue,
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const h = vi.hoisted(() => ({ access: null as Access | null }));

function respond(call: RecordedCall) {
  if (call.table === "invoicing_channels") {
    return { data: [{ id: "jouve_fiscal" }], error: null };
  }
  return { data: [], error: null };
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { listJournalEntriesAction } = await import("./journal-entries-actions");

function as(roles: Role[]) {
  h.access = resolveAccess(roles);
}

function journalCall() {
  return fake.calls.find((c) => c.table === "journal_entries");
}

beforeEach(() => {
  fake = recordingSupabase(respond);
  as(["owner"]);
});

describe("listJournalEntriesAction scope", () => {
  it("keeps entries without channel in the fiscal scope", async () => {
    as(["fiscal_reader"]);
    const res = await listJournalEntriesAction({ isFiscal: true });
    expect(res.ok).toBe(true);
    const call = journalCall();
    // recordingSupabase stores `.or(expr)` as [kind, expr, undefined].
    expect(call?.filters).toContainEqual([
      "or",
      'channel_id.is.null,channel_id.in.("jouve_fiscal")',
      undefined,
    ]);
  });

  it("drops entries without channel from the internal scope", async () => {
    await listJournalEntriesAction({ isFiscal: false });
    const call = journalCall();
    expect(filterValue(call!, "eq", "channel.is_fiscal")).toBe(false);
    expect(filterValue(call!, "not", "channel")).toEqual(["is", null]);
    expect(fake.calls.some((c) => c.table === "invoicing_channels")).toBe(
      false,
    );
  });

  it("reads every entry without scope", async () => {
    await listJournalEntriesAction({});
    const call = journalCall();
    expect(call?.filters.some(([k]) => k === "or" || k === "not")).toBe(false);
  });
});
