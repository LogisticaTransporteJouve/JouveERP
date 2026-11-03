import { describe, expect, it, vi } from "vitest";

import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

import { insightFingerprint } from "./lib/fingerprint";

const rpcResult = { data: 3 as unknown, error: null as unknown };
const fake = recordingSupabase((call) =>
  call.op === "rpc" ? rpcResult : { data: null, error: null },
);

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
const cash = { startingBalance: 100 };
vi.mock("./gather", () => ({
  gatherCashFlow: async () => ({
    startingBalance: cash.startingBalance,
    events: [{ date: "2026-10-20", amount: 50, label: "cobro" }],
  }),
  gatherReceivablesRisk: async () => ({
    clientCount: 0,
    total90Plus: 0,
    top: [],
  }),
}));
const gathers = { anomaliesFail: false, tripsFail: false };
vi.mock("./anomalies/gather", () => ({
  gatherAnomalies: async () => {
    if (gathers.anomaliesFail) throw new Error("timeout");
    return [
      ["a", "b"],
      ["c", "d"],
    ].map((refs) => ({
      kind: "dup_invoice",
      severity: "warning",
      title: "dup",
      finding: "",
      metrics: {},
      source_refs: refs,
    }));
  },
}));
vi.mock("./fleet/gather", () => ({
  gatherFleetDocExpiry: async () => [],
  gatherTripMargins: async () => {
    if (gathers.tripsFail) throw new Error("timeout");
    return [];
  },
}));
const indicators = {
  failed: [] as string[],
};
vi.mock("./indicators/gather", () => ({
  gatherIndicators: async () => ({
    findings: [],
    failed: indicators.failed,
  }),
}));

const { buildInsights, regenerateInsights } = await import("./analyst");

function lastRpc(): RecordedCall {
  const call = fake.calls.findLast((c) => c.op === "rpc");
  if (!call) throw new Error("no rpc");
  return call;
}

function rpcArg(name: string): unknown {
  return Reflect.get(Object(lastRpc().payload), name);
}

describe("regenerateInsights", () => {
  it("swaps the cards in one RPC with each finding's fingerprint", async () => {
    const count = await regenerateInsights("2026-10-19");
    expect(lastRpc().table).toBe("regenerate_ai_insights");
    expect(fake.calls.some((c) => c.op === "delete" || c.op === "insert")).toBe(
      false,
    );
    const rows = rpcArg("p_rows");
    const fingerprints = Array.isArray(rows)
      ? rows.map((r: unknown) => [
          Reflect.get(Object(r), "kind"),
          Reflect.get(Object(r), "fingerprint"),
        ])
      : [];
    expect(fingerprints).toEqual([
      ["cashflow", null],
      ["dup_invoice", insightFingerprint("dup_invoice", ["a", "b"])],
      ["dup_invoice", insightFingerprint("dup_invoice", ["c", "d"])],
    ]);
    expect(count).toBe(3);
  });

  it("fails the run when the swap fails, so the step retries", async () => {
    rpcResult.error = { message: "lock timeout" };
    await expect(regenerateInsights("2026-10-19")).rejects.toThrow(
      "lock timeout",
    );
    rpcResult.error = null;
  });
});

describe("failed reads keep their previous cards", () => {
  it("leaves out an indicator whose reads failed", async () => {
    indicators.failed = ["late_interest_uncharged"];
    await regenerateInsights("2026-10-19");
    indicators.failed = [];
    const kinds = rpcArg("p_kinds");
    expect(kinds).toContain("cash_vs_financing");
    expect(kinds).toContain("cashflow");
    expect(kinds).not.toContain("late_interest_uncharged");
  });

  it("leaves out the anomaly and trip kinds when their reads fail, and keeps the rest", async () => {
    gathers.anomaliesFail = true;
    gathers.tripsFail = true;
    await regenerateInsights("2026-10-19");
    gathers.anomaliesFail = false;
    gathers.tripsFail = false;
    const kinds = rpcArg("p_kinds");
    expect(kinds).not.toContain("dup_invoice");
    expect(kinds).not.toContain("unusual_amount");
    expect(kinds).not.toContain("trip_margin");
    expect(kinds).toContain("fleet_doc_expiry");
    expect(kinds).toContain("cashflow");
    const rows = rpcArg("p_rows");
    expect(
      Array.isArray(rows) &&
        rows.map((r: unknown) => Reflect.get(Object(r), "kind")),
    ).toEqual(["cashflow"]);
  });
});

describe("cash-flow card", () => {
  it("states today's cash, the flows and never calls an empty balance stable", async () => {
    cash.startingBalance = 100;
    const [stable] = await buildInsights("2026-10-19");
    expect(stable?.title).toBe("Caja proyectada estable");
    expect(stable?.finding).toContain("hoy hay $100");
    expect(stable?.finding).toContain("entradas por $50");

    cash.startingBalance = 0;
    const [empty] = await buildInsights("2026-10-19");
    expect(empty?.title).toBe("Caja sin saldo cargado");
    expect(empty?.severity).toBe("warning");
  });
});
