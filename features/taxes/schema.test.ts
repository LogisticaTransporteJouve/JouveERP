import { describe, expect, it } from "vitest";

import { ALL_SQL } from "@/lib/db/testing/migration-sql";

import {
  addOneMonth,
  computeIvaPosition,
  isTaxDocumentOverdue,
  monthGrid,
  PayTaxDocumentSchema,
  previousPeriod,
  shiftMonth,
  sumIva,
  TAX_KINDS,
  TAX_STATUSES,
  taxDocumentLabel,
  TaxDocumentCreateSchema,
  TaxStatusChangeSchema,
} from "./schema";

const UUID = "00000000-0000-4000-8000-000000000001";

describe("TaxDocumentCreateSchema", () => {
  const base = {
    kind: "iva",
    period: "2026-10",
    due_date: "2026-11-18",
  };

  it("accepts a pending document without amount or account", () => {
    const parsed = TaxDocumentCreateSchema.parse(base);
    expect(parsed).toMatchObject({
      amount: null,
      account_id: null,
      title: null,
      amount_is_estimate: false,
    });
  });

  it("an 'otro' needs its name", () => {
    const res = TaxDocumentCreateSchema.safeParse({ ...base, kind: "otro" });
    expect(res.success).toBe(false);
    expect(
      TaxDocumentCreateSchema.safeParse({
        ...base,
        kind: "otro",
        title: "Tasa municipal",
      }).success,
    ).toBe(true);
  });

  it("an estimate needs the amount, and the amount is positive", () => {
    expect(
      TaxDocumentCreateSchema.safeParse({ ...base, amount_is_estimate: true })
        .success,
    ).toBe(false);
    expect(
      TaxDocumentCreateSchema.safeParse({ ...base, amount: 0 }).success,
    ).toBe(false);
    expect(
      TaxDocumentCreateSchema.safeParse({
        ...base,
        amount: 1500.5,
        amount_is_estimate: true,
      }).success,
    ).toBe(true);
  });

  it("blank text fields become null", () => {
    const parsed = TaxDocumentCreateSchema.parse({
      ...base,
      title: "  ",
      jurisdiction: "",
      notes: "",
    });
    expect(parsed.title).toBeNull();
    expect(parsed.jurisdiction).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it("rejects a bad period or date", () => {
    expect(
      TaxDocumentCreateSchema.safeParse({ ...base, period: "2026-13" }).success,
    ).toBe(false);
    expect(
      TaxDocumentCreateSchema.safeParse({ ...base, due_date: "18/11/2026" })
        .success,
    ).toBe(false);
  });
});

describe("status and payment inputs", () => {
  it("'pagado' is not a manual transition", () => {
    expect(
      TaxStatusChangeSchema.safeParse({ id: UUID, status: "pagado" }).success,
    ).toBe(false);
    expect(
      TaxStatusChangeSchema.safeParse({ id: UUID, status: "liquidado" })
        .success,
    ).toBe(true);
  });

  it("a payment needs a positive amount", () => {
    const payment = {
      id: UUID,
      paid_date: "2026-11-18",
      account_id: UUID,
      amount: 100,
    };
    expect(PayTaxDocumentSchema.safeParse(payment).success).toBe(true);
    expect(
      PayTaxDocumentSchema.safeParse({ ...payment, amount: -1 }).success,
    ).toBe(false);
  });
});

describe("the lists mirror the table's CHECKs", () => {
  const table = /create table public\.tax_documents \(([\s\S]*?)\n\);/.exec(
    ALL_SQL,
  )?.[1];

  it.each(TAX_KINDS)("kind %s is allowed by the table", (kind) => {
    expect(table).toContain(`'${kind}'`);
  });

  it.each(TAX_STATUSES)("status %s is allowed by the table", (status) => {
    expect(table).toContain(`'${status}'`);
  });
});

describe("labels and dates", () => {
  it("names a document by kind, title and jurisdiction", () => {
    expect(
      taxDocumentLabel({ kind: "iva", title: null, jurisdiction: null }),
    ).toBe("IVA");
    expect(
      taxDocumentLabel({ kind: "iibb", title: null, jurisdiction: "CABA" }),
    ).toBe("IIBB (CABA)");
    expect(
      taxDocumentLabel({ kind: "otro", title: "Tasa", jurisdiction: null }),
    ).toBe("Tasa");
  });

  it("an open document past its due date is overdue; a paid one never", () => {
    expect(
      isTaxDocumentOverdue(
        { status: "pendiente", due_date: "2026-11-01" },
        "2026-11-03",
      ),
    ).toBe(true);
    expect(
      isTaxDocumentOverdue(
        { status: "liquidado", due_date: "2026-11-03" },
        "2026-11-03",
      ),
    ).toBe(false);
    expect(
      isTaxDocumentOverdue(
        { status: "pagado", due_date: "2026-10-01" },
        "2026-11-03",
      ),
    ).toBe(false);
  });

  it("moves periods and due dates by a month", () => {
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(previousPeriod("2026-11")).toBe("2026-10");
    expect(addOneMonth("2026-01-31")).toBe("2026-02-28");
    expect(addOneMonth("2026-12-18")).toBe("2027-01-18");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("lays a month out in Monday-first weeks", () => {
    // November 2026 starts on a Sunday.
    const weeks = monthGrid("2026-11");
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      "2026-11-01",
    ]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});

describe("computeIvaPosition", () => {
  it("débito − crédito − retenciones, rounded to cents", () => {
    expect(
      computeIvaPosition({
        period: "2026-10",
        debito: 2100.004,
        credito: 1050,
        retenciones: 50.5,
        ventas: 3,
        compras: 2,
      }),
    ).toEqual({
      period: "2026-10",
      debito: 2100,
      credito: 1050,
      retenciones: 50.5,
      saldo: 999.5,
      ventas: 3,
      compras: 2,
    });
  });

  it("a negative saldo is a balance in favour", () => {
    expect(
      computeIvaPosition({
        period: "2026-10",
        debito: 100,
        credito: 300,
        retenciones: 0,
        ventas: 1,
        compras: 1,
      }).saldo,
    ).toBe(-200);
  });

  it("sums the IVA of every rate", () => {
    expect(
      sumIva({ 5: { neto: 1000, iva: 210 }, 4: { neto: 100, iva: 10.5 } }),
    ).toBe(220.5);
  });
});
