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
// the action itself must still drop cards outside the caller's domains. It
// serves `liveRows` page by page, like PostgREST's `max_rows`.
let liveRows: Array<Record<string, unknown>> = rows;
let updated: Array<{ id: string }> = [];
const chain = {
  select: () => chain,
  neq: () => chain,
  order: () => chain,
  eq: () => chain,
  update: () => ({
    eq: () => ({ select: async () => ({ data: updated, error: null }) }),
  }),
  range: async (from: number, to: number) => ({
    data: liveRows.slice(from, to + 1),
    error: null,
  }),
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

const { listInsightsAction, setInsightStatusAction } =
  await import("./actions");

async function kindsFor(r: Role[]): Promise<string[]> {
  roles = r;
  const res = await listInsightsAction();
  if (!res.ok) throw new Error(res.error);
  return res.data.items.map((c) => c.kind).sort();
}

beforeEach(() => {
  roles = [];
  denied = [];
  liveRows = rows;
  updated = [];
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
    return Object.fromEntries(res.data.items.map((c) => [c.kind, c.proposal]));
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

describe("listInsightsAction over a large run", () => {
  // One run shares one generated_at: 1200 finance info cards, then the
  // critical fleet card last in id order and past the first page.
  const run = [
    ...Array.from({ length: 1200 }, (_, i) => ({
      ...rows[2]!,
      id: `a${String(i).padStart(5, "0")}`,
      severity: "info",
      generated_at: "2026-07-01T00:00:00Z",
    })),
    {
      ...rows[4]!,
      id: "z-critical",
      severity: "critical",
      generated_at: "2026-07-01T00:00:00Z",
    },
  ];

  it("keeps a critical card first and counts every visible card", async () => {
    liveRows = run;
    roles = ["admin"];
    const res = await listInsightsAction();
    if (!res.ok) throw new Error(res.error);
    expect(res.data.items[0]?.id).toBe("z-critical");
    expect(res.data.items).toHaveLength(50);
    expect(res.data.total).toBe(1201);
  });

  it("filters by domain before the cap", async () => {
    liveRows = run;
    roles = ["operations"];
    const res = await listInsightsAction();
    if (!res.ok) throw new Error(res.error);
    expect(res.data.items.map((c) => c.id)).toEqual(["z-critical"]);
    expect(res.data.total).toBe(1);
  });
});

describe("setInsightStatusAction", () => {
  it("refuses when the card was replaced by a recalculation", async () => {
    roles = ["admin"];
    updated = [];
    const res = await setInsightStatusAction({
      id: "gone",
      status: "acknowledged",
    });
    expect(res).toEqual({
      ok: false,
      error: "Esta tarjeta se recalculó. Recargá los insights.",
    });
  });

  it("succeeds when the row was updated", async () => {
    roles = ["admin"];
    updated = [{ id: "i0" }];
    const res = await setInsightStatusAction({
      id: "i0",
      status: "acknowledged",
    });
    expect(res.ok).toBe(true);
  });
});
