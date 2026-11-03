import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordingSupabase,
  type FakeResponse,
} from "@/tests/helpers/recording-supabase";

vi.mock("server-only", () => ({}));

let pages: FakeResponse[] = [];
const fake = recordingSupabase(
  () => pages.shift() ?? { data: [], error: null },
);
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));

const { gatherAnomalies } = await import("./gather");

const invoice = (id: string, numero: number, moneda: string) => ({
  id,
  supplier_id: "s1",
  imp_total: 1000,
  moneda,
  fecha: "2026-10-01",
  numero,
  punto_venta: 1,
  supplier: { legal_name: "Proveedor SA" },
  channel: { is_fiscal: true },
});

beforeEach(() => {
  pages = [];
});

describe("gatherAnomalies", () => {
  it("reads every page and keeps each invoice's currency", async () => {
    // Two pages: a duplicate pair split across the PostgREST cap.
    pages = [
      { data: [invoice("a", 1, "PES")], error: null },
      { data: [invoice("b", 2, "PES"), invoice("c", 3, "DOL")], error: null },
    ];
    const findings = await gatherAnomalies("2026-11-03");
    expect(findings.map((f) => [f.kind, f.source_refs])).toEqual([
      ["dup_invoice", ["a", "b"]],
    ]);
  });

  it("throws on a failed read instead of reporting no anomalies", async () => {
    pages = [{ data: null, error: { message: "timeout" } }];
    await expect(gatherAnomalies("2026-11-03")).rejects.toThrow("timeout");
  });
});
