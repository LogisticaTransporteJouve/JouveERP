import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = [];
let denied: string[] = [];

const rows = [
  "cashflow",
  "receivables_risk",
  "dup_invoice",
  "unusual_amount",
  "fleet_doc_expiry",
  "trip_margin",
].map((kind, i) => ({
  id: `i${i}`,
  kind,
  severity: "warning",
  title: kind,
  finding: "",
  metrics: {},
  source_refs: [],
  period: null,
  status: "open",
  generated_at: `2026-07-0${i + 1}T00:00:00Z`,
  proposal:
    kind === "receivables_risk"
      ? {
          action: "proposeLateInterestNd",
          label: "Generar ND por mora",
          input: { invoice_id: "x" },
        }
      : kind === "trip_margin"
        ? { action: "notAnAction", label: "x", input: {} }
        : null,
}));

// The RLS client is mocked to return every row (as a too-broad policy would):
// the action itself must still drop cards outside the caller's domains.
const chain = {
  select: () => chain,
  neq: () => chain,
  order: () => chain,
  limit: async () => ({ data: rows, error: null }),
};

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => chain }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: async () => undefined }));
vi.mock("./analyst", () => ({ regenerateInsights: vi.fn() }));

const { listInsightsAction } = await import("./actions");

async function kindsFor(r: Role[]): Promise<string[]> {
  roles = r;
  const res = await listInsightsAction();
  if (!res.ok) throw new Error(res.error);
  return res.data.map((c) => c.kind).sort();
}

beforeEach(() => {
  roles = [];
  denied = [];
});

describe("listInsightsAction", () => {
  it("never returns treasury / AR / AP cards to operations", async () => {
    expect(await kindsFor(["operations"])).toEqual([
      "fleet_doc_expiry",
      "trip_margin",
    ]);
  });

  it("returns only finance-domain cards to finance", async () => {
    expect(await kindsFor(["finance"])).toEqual([
      "cashflow",
      "dup_invoice",
      "receivables_risk",
      "unusual_amount",
    ]);
  });

  it("returns everything to admin", async () => {
    expect(await kindsFor(["admin"])).toHaveLength(rows.length);
  });
});

describe("insight proposals", () => {
  async function proposals() {
    const res = await listInsightsAction();
    if (!res.ok) throw new Error(res.error);
    return Object.fromEntries(res.data.map((c) => [c.kind, c.proposal]));
  }

  it("offers the button only when the user may run the action", async () => {
    roles = ["finance"];
    expect((await proposals()).receivables_risk).toEqual({
      action: "proposeLateInterestNd",
      label: "Generar ND por mora",
    });
    denied = ["credit_debit_notes:issue"];
    expect((await proposals()).receivables_risk).toBeNull();
  });

  it("drops a proposal whose action is not a registry proposal", async () => {
    roles = ["admin"];
    expect((await proposals()).trip_margin).toBeNull();
  });
});
