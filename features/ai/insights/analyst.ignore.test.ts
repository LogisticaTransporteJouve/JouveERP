import { describe, expect, it, vi } from "vitest";

import {
  filterValue,
  recordingSupabase,
} from "@/tests/helpers/recording-supabase";

import { insightFingerprint } from "./lib/fingerprint";

const ignoredFp = insightFingerprint("dup_invoice", ["a", "b"]);
const seenFp = insightFingerprint("dup_invoice", ["c", "d"]);
const fake = recordingSupabase((call) =>
  call.op === "select"
    ? {
        data: [
          { fingerprint: ignoredFp, status: "dismissed" },
          { fingerprint: seenFp, status: "acknowledged" },
        ],
        error: null,
      }
    : { data: null, error: null },
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
vi.mock("./anomalies/gather", () => ({
  gatherAnomalies: async () =>
    [
      ["a", "b"],
      ["c", "d"],
    ].map((refs) => ({
      kind: "dup_invoice",
      severity: "warning",
      title: "dup",
      finding: "",
      metrics: {},
      source_refs: refs,
    })),
}));
vi.mock("./fleet/gather", () => ({ gatherFleetInsights: async () => [] }));

const { buildInsights, regenerateInsights, withoutIgnored } =
  await import("./analyst");

const row = (kind: string, refs: string[]) => ({
  kind,
  severity: "warning" as const,
  title: kind,
  finding: "",
  metrics: {},
  source_refs: refs,
});

describe("withoutIgnored", () => {
  it("drops a finding someone ignored and keeps new ones and aggregate cards", () => {
    const kept = withoutIgnored(
      [
        row("dup_invoice", ["b", "a"]),
        row("dup_invoice", ["c", "d"]),
        row("cashflow", []),
      ],
      new Set(ignoredFp ? [ignoredFp] : []),
    );
    expect(kept.map((r) => [r.kind, r.source_refs])).toEqual([
      ["dup_invoice", ["c", "d"]],
      ["cashflow", []],
    ]);
    expect(kept[1]?.fingerprint).toBeNull();
  });
});

describe("regenerateInsights", () => {
  it("looks up only this run's fingerprints and skips the ignored one", async () => {
    const count = await regenerateInsights("2026-10-19");
    const lookup = fake.calls.find((c) => c.op === "select");
    expect(lookup && filterValue(lookup, "in", "status")).toEqual([
      "dismissed",
      "acknowledged",
    ]);
    expect(lookup && filterValue(lookup, "in", "fingerprint")).toEqual([
      ignoredFp,
      insightFingerprint("dup_invoice", ["c", "d"]),
    ]);
    const insert = fake.calls.find((c) => c.op === "insert");
    const kinds = Array.isArray(insert?.payload)
      ? insert.payload.map((r: unknown) =>
          Reflect.get(Object(r), "fingerprint"),
        )
      : [];
    expect(kinds).not.toContain(ignoredFp);
    expect(count).toBe(2);
  });

  it("replaces acknowledged rows too and keeps the status of a seen finding", async () => {
    fake.calls.length = 0;
    await regenerateInsights("2026-10-19");
    const del = fake.calls.find((c) => c.op === "delete");
    expect(del && filterValue(del, "in", "status")).toEqual([
      "open",
      "acknowledged",
    ]);
    const insert = fake.calls.find((c) => c.op === "insert");
    const statuses = Array.isArray(insert?.payload)
      ? insert.payload.map((r: unknown) => [
          Reflect.get(Object(r), "kind"),
          Reflect.get(Object(r), "status"),
        ])
      : [];
    expect(statuses).toEqual([
      ["cashflow", "open"],
      ["dup_invoice", "acknowledged"],
    ]);
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
