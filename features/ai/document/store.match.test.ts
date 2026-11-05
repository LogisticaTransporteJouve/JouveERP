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
const reconcileExtracto = vi.fn();
vi.mock("@/features/ai/reconciliation/gather", () => ({
  reconcileExtracto: (...args: unknown[]) => reconcileExtracto(...args),
}));

const {
  comprobanteKinds,
  extractionRequester,
  matchForKind,
  unverifiedMatches,
} = await import("./store");

const all = () => true;

const SUPPLIER = "s1";

beforeEach(() => {
  fake.calls.length = 0;
  reconcileExtracto.mockReset();
  answer = (call) =>
    call.table === "suppliers"
      ? {
          data: [{ id: SUPPLIER, legal_name: "Prov SA", cuit: "1" }],
          error: null,
        }
      : { data: [], error: null };
});

const invoiceLookup = (table: string) =>
  fake.calls.find((c) => c.table === table && c.op === "select");

describe("scanned-document duplicate check", () => {
  it("matches a purchase note on the supplier's numbering key: kind and letter included", async () => {
    await matchForKind(
      "credit_debit_note",
      {
        counterparty_cuit: "20-12345678-9",
        number: 5,
        sales_point: 3,
        letter: "A",
        kind: "credit_note",
      },
      all,
    );
    const lookup = invoiceLookup("purchase_invoices");
    expect(lookup && filterValue(lookup, "eq", "supplier_id")).toBe(SUPPLIER);
    expect(lookup && filterValue(lookup, "in", "kind")).toEqual(["nc"]);
    expect(lookup && filterValue(lookup, "eq", "letter")).toBe("A");
  });

  it("matches a sales invoice on its kind and letter, so a Factura B is not a Factura A", async () => {
    await matchForKind(
      "sales_invoice",
      {
        number: 5,
        sales_point: 1,
        letter: "B",
      },
      all,
    );
    const lookup = invoiceLookup("invoices");
    expect(lookup && filterValue(lookup, "in", "kind")).toEqual(["factura"]);
    expect(lookup && filterValue(lookup, "eq", "letter")).toBe("B");
  });

  it("throws when the lookup fails, so the step retries instead of storing no duplicate", async () => {
    answer = () => ({ data: null, error: { message: "timeout" } });
    await expect(
      matchForKind("sales_invoice", { number: 5, sales_point: 1 }, all),
    ).rejects.toMatchObject({ message: "timeout" });
  });

  it("reports the duplicate it finds", async () => {
    answer = (call) =>
      call.table === "invoices"
        ? { data: [{ id: "inv-1" }], error: null }
        : { data: [], error: null };
    const matches = await matchForKind(
      "sales_invoice",
      {
        number: 5,
        sales_point: 1,
        letter: "A",
      },
      all,
    );
    expect(matches).toEqual({ duplicate_of: "inv-1" });
  });
});

describe("scanned-document matches follow the uploader's access", () => {
  const purchase = {
    counterparty_cuit: "20-12345678-9",
    number: 5,
    sales_point: 3,
    letter: "A",
    kind: "invoice",
  };

  it("without purchase_invoices:read no duplicate check runs: it reads as not verified", async () => {
    answer = (call) =>
      call.table === "purchase_invoices"
        ? { data: [{ id: "pi-1" }], error: null }
        : call.table === "suppliers"
          ? {
              data: [{ id: SUPPLIER, legal_name: "Prov SA", cuit: "1" }],
              error: null,
            }
          : { data: [], error: null };
    const matches = await matchForKind(
      "purchase_invoice",
      purchase,
      (p) => p === "suppliers:read",
    );
    expect(invoiceLookup("purchase_invoices")).toBeUndefined();
    expect(matches).toEqual({
      supplier_id: SUPPLIER,
      supplier_name: "Prov SA",
      duplicate_unknown: true,
    });
  });

  it("without suppliers:read the duplicate is checked but the supplier is not stored", async () => {
    answer = (call) =>
      call.table === "purchase_invoices"
        ? { data: [{ id: "pi-1" }], error: null }
        : call.table === "suppliers"
          ? {
              data: [{ id: SUPPLIER, legal_name: "Prov SA", cuit: "1" }],
              error: null,
            }
          : { data: [], error: null };
    const matches = await matchForKind(
      "purchase_invoice",
      purchase,
      (p) => p === "purchase_invoices:read",
    );
    expect(matches).toEqual({
      duplicate_of: "pi-1",
      counterparty_unchecked: true,
    });
  });

  it.each([
    ["receipt", "clients:read"],
    ["payment_order", "suppliers:read"],
  ] as const)(
    "a %s scanned without %s marks the counterparty as not checked, not missing",
    async (kind, permission) => {
      const payload = { counterparty_cuit: "20-12345678-9" };
      expect(await matchForKind(kind, payload, () => false)).toEqual({
        counterparty_unchecked: true,
      });
      expect(fake.calls).toEqual([]);
      const allowed = await matchForKind(
        kind,
        payload,
        (p) => p === permission,
      );
      expect(allowed.counterparty_unchecked).toBeUndefined();
    },
  );

  it("without invoices:read a sales invoice is not looked up, and is not reported as new", async () => {
    const matches = await matchForKind(
      "sales_invoice",
      { number: 5, sales_point: 1, letter: "A" },
      () => false,
    );
    expect(fake.calls).toEqual([]);
    expect(matches).toEqual({ duplicate_unknown: true });
  });

  it("without transactions:read a bank statement is not compared with Caja", async () => {
    reconcileExtracto.mockResolvedValue({ matched: 1 });
    const statement = { movements: [{ date: "2026-11-01", credit: 10 }] };
    expect(
      await matchForKind(
        "bank_statement",
        statement,
        (p) => p !== "transactions:read",
      ),
    ).toEqual({});
    expect(reconcileExtracto).not.toHaveBeenCalled();
    expect(await matchForKind("bank_statement", statement, all)).toEqual({
      reconciliation: { matched: 1 },
    });
  });
});

describe("a failed lookup is not «not found» (audit w13-s6 F1)", () => {
  it.each([
    ["receipt", "clients"],
    ["payment_order", "suppliers"],
  ])(
    "a %s's failed %s lookup throws, so the step retries",
    async (kind, table) => {
      answer = (call) =>
        call.table === table
          ? { data: null, error: { message: "timeout" } }
          : { data: [], error: null };
      await expect(
        matchForKind(kind, { counterparty_cuit: "20-12345678-9" }, all),
      ).rejects.toMatchObject({ message: "timeout" });
    },
  );

  it("a bank statement whose reconciliation read fails throws too", async () => {
    reconcileExtracto.mockRejectedValue(new Error("reconcile-extracto: boom"));
    await expect(
      matchForKind(
        "bank_statement",
        { movements: [{ date: "2026-11-01", credit: 10 }] },
        all,
      ),
    ).rejects.toThrow("boom");
  });

  it("a statement over the row cap is stored as not reconciled, not as no movements", async () => {
    reconcileExtracto.mockResolvedValue("too_many_rows");
    expect(
      await matchForKind(
        "bank_statement",
        { movements: [{ date: "2026-11-01", credit: 10 }] },
        all,
      ),
    ).toEqual({ reconciliation_unchecked: true });
  });
});

describe("the scanned CUIT in the lookup filter (audit w14-s6 F2)", () => {
  it("looks the counterparty up by its 11 digits only", async () => {
    await matchForKind(
      "receipt",
      { counterparty_cuit: " 20-12345678-9 " },
      all,
    );
    const lookup = fake.calls.find((c) => c.table === "clients");
    expect(lookup && filterValue(lookup, "eq", "cuit")).toBe("20123456789");
  });

  it("skips the lookup for a CUIT that is not 11 digits, quotes and commas included", async () => {
    const matches = await matchForKind(
      "purchase_invoice",
      {
        counterparty_cuit: '30-7123 ("RI", CABA)',
        number: 5,
        sales_point: 3,
      },
      all,
    );
    expect(fake.calls.find((c) => c.table === "suppliers")).toBeUndefined();
    expect(matches.counterparty_unchecked).toBeUndefined();
    expect(matches.supplier_id).toBeUndefined();
  });
});

describe("unverifiedMatches (audit w14-s5 F2)", () => {
  it("marks every comparison the kind runs as not verified", () => {
    expect(unverifiedMatches("purchase_invoice")).toEqual({
      lookup_failed: true,
      counterparty_unchecked: true,
      duplicate_unknown: true,
    });
    expect(unverifiedMatches("receipt")).toEqual({
      lookup_failed: true,
      counterparty_unchecked: true,
    });
    expect(unverifiedMatches("bank_statement")).toEqual({
      lookup_failed: true,
      reconciliation_unchecked: true,
    });
  });
});

describe("extractionRequester", () => {
  it("throws on a failed read, so the step retries instead of matching nothing", async () => {
    answer = () => ({ data: null, error: { message: "timeout" } });
    await expect(extractionRequester("x1")).rejects.toMatchObject({
      message: "timeout",
    });
  });

  it("returns null only for a row with no uploader", async () => {
    answer = () => ({ data: { created_by: null }, error: null });
    expect(await extractionRequester("x1")).toBeNull();
    answer = () => ({ data: { created_by: "u1" }, error: null });
    expect(await extractionRequester("x1")).toBe("u1");
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
