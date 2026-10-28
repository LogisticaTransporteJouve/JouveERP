import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Access } from "@/lib/auth/permissions";

type Row = { entity_type: string; entity_id: string };

const h = await vi.hoisted(async () => {
  const { resolveAccess } = await import("@/lib/auth/permissions");
  const state: {
    access: Access;
    calls: Record<string, unknown>[];
    responses: Array<{ data: Row[] | null; error: { code: string } | null }>;
    resolveAccess: typeof resolveAccess;
  } = {
    access: resolveAccess(["finance"]),
    calls: [],
    responses: [],
    resolveAccess,
  };
  return state;
});

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/observability", () => ({
  captureException: vi.fn(),
  captureMessageOnce: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      h.calls.push(args);
      return h.responses.shift() ?? { data: [], error: null };
    },
  }),
}));

const { searchGlobalAction } = await import("./search-actions");

beforeEach(() => {
  h.access = h.resolveAccess(["finance"]);
  h.calls = [];
  h.responses = [];
});

describe("searchGlobalAction", () => {
  it("drops the entity types a deny hides from the search", async () => {
    h.access = h.resolveAccess(["finance"], ["invoices:read"]);
    await searchGlobalAction({ query: "acme" });
    const types = h.calls[0]?.p_types;
    expect(types).toContain("client");
    expect(types).not.toContain("invoice");
  });

  it("does not search when no indexed type is readable", async () => {
    h.access = h.resolveAccess([]);
    expect(await searchGlobalAction({ query: "acme" })).toEqual({
      ok: true,
      data: [],
    });
    expect(h.calls).toEqual([]);
  });

  it("filters in the app against an RPC without p_types", async () => {
    h.access = h.resolveAccess(["finance"], ["invoices:read"]);
    h.responses = [
      { data: null, error: { code: "PGRST202" } },
      {
        data: [
          { entity_type: "invoice", entity_id: "i1" },
          { entity_type: "client", entity_id: "c1" },
        ],
        error: null,
      },
    ];
    const res = await searchGlobalAction({ query: "acme" });
    expect(h.calls[1]).not.toHaveProperty("p_types");
    expect(res).toEqual({
      ok: true,
      data: [{ entity_type: "client", entity_id: "c1" }],
    });
  });

  it("reports any other RPC error", async () => {
    h.responses = [{ data: null, error: { code: "57014" } }];
    expect((await searchGlobalAction({ query: "acme" })).ok).toBe(false);
  });
});
