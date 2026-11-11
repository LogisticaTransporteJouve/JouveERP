import { describe, expect, it } from "vitest";

import { ALL_SQL } from "@/lib/db/testing/migration-sql";

import {
  addOneMonth,
  computeIvaPosition,
  isTaxDocumentOverdue,
  LinkTaxPaymentSchema,
  PayTaxDocumentSchema,
  previousIvaCreditBalance,
  previousPeriod,
  rankTaxPaymentCandidates,
  sumIva,
  TAX_KINDS,
  TAX_STATUSES,
  taxDocumentLabel,
  taxDocumentNeedsPayment,
  TaxDocumentCreateSchema,
  TaxPaymentCandidatesSchema,
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
    const amounts = { amount: null, credit_balance: null };
    expect(
      isTaxDocumentOverdue(
        { ...amounts, status: "pendiente", due_date: "2026-11-01" },
        "2026-11-03",
      ),
    ).toBe(true);
    expect(
      isTaxDocumentOverdue(
        { ...amounts, status: "liquidado", due_date: "2026-11-03" },
        "2026-11-03",
      ),
    ).toBe(false);
    expect(
      isTaxDocumentOverdue(
        { ...amounts, status: "pagado", due_date: "2026-10-01" },
        "2026-11-03",
      ),
    ).toBe(false);
  });

  it("a DDJJ that only leaves a saldo a favor has nothing to pay", () => {
    const creditOnly: Parameters<typeof isTaxDocumentOverdue>[0] = {
      status: "pendiente",
      due_date: "2026-11-01",
      amount: null,
      credit_balance: 5000,
    };
    expect(taxDocumentNeedsPayment(creditOnly)).toBe(false);
    expect(isTaxDocumentOverdue(creditOnly, "2026-11-03")).toBe(false);
    // An amount still owed, or one not typed yet, keeps it payable.
    expect(taxDocumentNeedsPayment({ ...creditOnly, amount: 100 })).toBe(true);
    expect(
      taxDocumentNeedsPayment({ ...creditOnly, credit_balance: null }),
    ).toBe(true);
  });

  it("moves periods and due dates by a month", () => {
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(previousPeriod("2026-11")).toBe("2026-10");
    expect(addOneMonth("2026-01-31")).toBe("2026-02-28");
    expect(addOneMonth("2026-12-18")).toBe("2027-01-18");
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
        saldoAnterior: 100,
        percepcionesCompras: 0,
        tributosCompras: 12.345,
        ventas: 3,
        compras: 2,
      }),
    ).toEqual({
      period: "2026-10",
      debito: 2100,
      credito: 1050,
      retenciones: 50.5,
      saldo_anterior: 100,
      saldo_anterior_known: true,
      percepciones_compras: 0,
      saldo: 899.5,
      tributos_compras: 12.35,
      ventas: 3,
      compras: 2,
    });
  });

  it("subtracts the purchases' IVA perceptions as a payment on account", () => {
    expect(
      computeIvaPosition({
        period: "2026-10",
        debito: 1000,
        credito: 400,
        retenciones: 0,
        saldoAnterior: 0,
        percepcionesCompras: 30,
        tributosCompras: 20,
        ventas: 1,
        compras: 1,
      }),
    ).toMatchObject({
      percepciones_compras: 30,
      saldo: 570,
      tributos_compras: 20,
    });
  });

  it("a negative saldo is a balance in favour", () => {
    expect(
      computeIvaPosition({
        period: "2026-10",
        debito: 100,
        credito: 300,
        retenciones: 0,
        saldoAnterior: null,
        percepcionesCompras: 0,
        tributosCompras: 0,
        ventas: 1,
        compras: 1,
      }).saldo,
    ).toBe(-200);
  });

  it("last month's saldo a favor: live documents add up, else the latest annulled one", () => {
    const at = (h: number) => `2026-10-01T${String(h).padStart(2, "0")}:00:00Z`;
    expect(previousIvaCreditBalance([])).toBeNull();
    expect(
      previousIvaCreditBalance([
        { status: "liquidado", credit_balance: 100, updated_at: at(1) },
        { status: "pendiente", credit_balance: null, updated_at: at(2) },
        { status: "anulado", credit_balance: 999, updated_at: at(3) },
      ]),
    ).toBe(100);
    expect(
      previousIvaCreditBalance([
        { status: "anulado", credit_balance: 50, updated_at: at(1) },
        { status: "anulado", credit_balance: 70, updated_at: at(4) },
        { status: "anulado", credit_balance: null, updated_at: at(5) },
      ]),
    ).toBe(70);
    expect(
      previousIvaCreditBalance([
        { status: "anulado", credit_balance: null, updated_at: at(1) },
      ]),
    ).toBe(0);
  });

  it("only an IVA document carries a saldo a favor", () => {
    const base = { period: "2026-10", due_date: "2026-11-18" };
    expect(
      TaxDocumentCreateSchema.safeParse({
        ...base,
        kind: "iva",
        credit_balance: 10,
      }).success,
    ).toBe(true);
    expect(
      TaxDocumentCreateSchema.safeParse({
        ...base,
        kind: "iibb",
        credit_balance: 10,
      }).success,
    ).toBe(false);
  });

  it("sums the IVA of every rate", () => {
    expect(
      sumIva({ 5: { neto: 1000, iva: 210 }, 4: { neto: 100, iva: 10.5 } }),
    ).toBe(220.5);
  });
});

describe("linking an existing movement", () => {
  const UUID = "00000000-0000-4000-8000-000000000001";

  it("the link defaults to refusing another amount", () => {
    expect(
      LinkTaxPaymentSchema.parse({ id: UUID, transaction_id: UUID }),
    ).toEqual({ id: UUID, transaction_id: UUID, allow_difference: false });
    expect(
      LinkTaxPaymentSchema.safeParse({ id: UUID, transaction_id: "x" }).success,
    ).toBe(false);
  });

  it("candidates start at the first page", () => {
    expect(TaxPaymentCandidatesSchema.parse({ id: UUID }).page).toBe(0);
    expect(
      TaxPaymentCandidatesSchema.safeParse({ id: UUID, page: -1 }).success,
    ).toBe(false);
  });

  const row = (id: string, amount: number, date: string) => ({
    id,
    amount,
    transaction_date: date,
    description: null,
    account_name: "Banco",
  });

  it("ranks by amount, then by distance to the due date", () => {
    const ranked = rankTaxPaymentCandidates(
      [
        row("far-date", 1000, "2026-11-01"),
        row("off", 999.5, "2026-11-18"),
        row("near-date", 1000, "2026-11-17"),
      ],
      { amount: 1000, due_date: "2026-11-18" },
    );
    expect(ranked.map((r) => [r.id, r.difference, r.days_from_due])).toEqual([
      ["near-date", 0, -1],
      ["far-date", 0, -17],
      ["off", -0.5, 0],
    ]);
  });

  it("without an amount, only the date ranks and there is no difference", () => {
    const ranked = rankTaxPaymentCandidates(
      [row("b", 5, "2026-11-25"), row("a", 9, "2026-11-19")],
      { amount: null, due_date: "2026-11-18" },
    );
    expect(ranked.map((r) => [r.id, r.difference])).toEqual([
      ["a", null],
      ["b", null],
    ]);
  });

  it("the link RPC re-posts and refuses a different amount unless confirmed", () => {
    const fn = ALL_SQL.slice(
      ALL_SQL.indexOf("create function public.link_tax_document_payment("),
    );
    expect(fn).toMatch(/perform public\.repost_journal\('transactions'/);
    expect(fn).toMatch(/p_allow_difference/);
  });
});
