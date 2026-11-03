import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterValue,
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

let answer: (call: RecordedCall) => FakeResponse = () => ({
  data: [],
  error: null,
});
const fake = recordingSupabase((call) => answer(call));

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/features/ai/reconciliation/gather", () => ({
  reconcileExtracto: vi.fn(),
}));

const { comprobanteKinds, matchForKind } = await import("./store");

const SUPPLIER = "s1";

beforeEach(() => {
  fake.calls.length = 0;
  answer = (call) =>
    call.table === "suppliers"
      ? { data: [{ id: SUPPLIER, legal_name: "Prov SA", cuit: "1" }], error: null }
      : { data: [], error: null };
});

const invoiceLookup = (table: string) =>
  fake.calls.find((c) => c.table === table && c.op === "select");

describe("scanned-document duplicate check", () => {
  it("matches a purchase note on the supplier's numbering key: kind and letter included", async () => {
    await matchForKind("credit_debit_note", {
      counterparty_cuit: "20-12345678-9",
      number: 5,
      sales_point: 3,
      letter: "A",
      kind: "credit_note",
    });
    const lookup = invoiceLookup("purchase_invoices");
    expect(lookup && filterValue(lookup, "eq", "supplier_id")).toBe(SUPPLIER);
    expect(lookup && filterValue(lookup, "in", "kind")).toEqual(["nc"]);
    expect(lookup && filterValue(lookup, "eq", "letter")).toBe("A");
  });

  it("matches a sales invoice on its kind and letter, so a Factura B is not a Factura A", async () => {
    await matchForKind("sales_invoice", {
      number: 5,
      sales_point: 1,
      letter: "B",
    });
    const lookup = invoiceLookup("invoices");
    expect(lookup && filterValue(lookup, "in", "kind")).toEqual(["factura"]);
    expect(lookup && filterValue(lookup, "eq", "letter")).toBe("B");
  });

  it("flags the check as unknown when the lookup fails, instead of no duplicate", async () => {
    answer = () => ({ data: null, error: { message: "timeout" } });
    const matches = await matchForKind("sales_invoice", {
      number: 5,
      sales_point: 1,
    });
    expect(matches.duplicate_of).toBeUndefined();
    expect(matches.duplicate_unknown).toBe(true);
  });

  it("reports the duplicate it finds", async () => {
    answer = (call) =>
      call.table === "invoices"
        ? { data: [{ id: "inv-1" }], error: null }
        : { data: [], error: null };
    const matches = await matchForKind("sales_invoice", {
      number: 5,
      sales_point: 1,
      letter: "A",
    });
    expect(matches).toEqual({ duplicate_of: "inv-1" });
  });
});

describe("comprobanteKinds", () => {
  it("takes the printed type first, then the detected document", () => {
    expect(comprobanteKinds("credit_debit_note", "debit_note")).toEqual(["nd"]);
    expect(comprobanteKinds("credit_debit_note", null)).toEqual(["nc", "nd"]);
    expect(comprobanteKinds("purchase_invoice", undefined)).toEqual([
      "factura",
    ]);
    expect(comprobanteKinds("receipt", undefined)).toBeNull();
  });
});
