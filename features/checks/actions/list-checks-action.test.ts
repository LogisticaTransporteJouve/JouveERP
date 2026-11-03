import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import { SETTLED_LIST_CAP } from "@/lib/supabase/open-and-recent";
import {
  filterValue,
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// More than SETTLED_LIST_CAP settled checks must never push a check in
// cartera off the list, and the cut is reported.

let openPages: Record<string, unknown>[][] = [];
let settled: Record<string, unknown>[] = [];

function check(id: string, status: string, due_date: string) {
  return {
    id,
    kind: "fisico",
    status,
    currency: "ARS",
    due_date,
    amount: 10,
    cartera_account: { name: "Cartera" },
    source_client: null,
  };
}

function respond(call: RecordedCall) {
  const statuses = filterValue(call, "in", "status");
  if (Array.isArray(statuses) && statuses.includes("en_cartera")) {
    return { data: openPages.shift() ?? [], error: null };
  }
  return { data: settled, error: null };
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { listChecksAction } = await import("./checks-actions");

beforeEach(() => {
  fake = recordingSupabase(respond);
});

describe("listChecksAction", () => {
  it("lists every check in cartera however many settled ones exist", async () => {
    openPages = [[check("new", "en_cartera", "2026-12-01")]];
    settled = Array.from({ length: SETTLED_LIST_CAP + 1 }, (_, i) =>
      check(`old-${i}`, "acreditado", "2020-01-01"),
    );
    const res = await listChecksAction();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((c) => c.id)).toContain("new");
    expect(res.data.items).toHaveLength(SETTLED_LIST_CAP + 1);
    expect(res.data.truncated).toBe(true);
  });

  it("is not truncated while the settled checks fit", async () => {
    openPages = [[check("new", "en_cartera", "2026-12-01")]];
    settled = [check("old", "acreditado", "2020-01-01")];
    const res = await listChecksAction();
    expect(res.ok && res.data.truncated).toBe(false);
  });

  it("fails instead of listing a partial cartera", async () => {
    fake = recordingSupabase((call) =>
      Array.isArray(filterValue(call, "in", "status")) &&
      (filterValue(call, "in", "status") as string[]).includes("en_cartera")
        ? { data: null, error: { message: "boom" } }
        : { data: [], error: null },
    );
    const res = await listChecksAction();
    expect(res.ok).toBe(false);
  });
});
