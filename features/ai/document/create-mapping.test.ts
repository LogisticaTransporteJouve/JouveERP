import { describe, expect, it } from "vitest";

import { draftToFormPatch } from "@/features/purchase-invoices/lib/purchase-invoice-draft";
import { PurchaseInvoiceCreateSchema } from "@/features/purchase-invoices/schema";
import { parseArAmount } from "@/lib/format";
import { TRIBUTE_SUGGESTION_NOTE } from "@/lib/purchases/tribute-split";

import {
  buildPurchaseInvoiceDraft,
  buildSalesInvoiceItems,
} from "./create-mapping";

const IVA_NOTE = TRIBUTE_SUGGESTION_NOTE.iva_rate;

const SUPPLIER = {
  id: "11111111-1111-4111-8111-111111111111",
  legal_name: "ACME SA",
  display_name: null,
  cuit: "30712345678",
  iva_condition: "responsable_inscripto" as const,
};

const OPTS = {
  fallbackKind: "factura" as const,
  supplier: SUPPLIER,
  account: null,
  costCenterId: null,
  usdRate: null,
  confidence: 1,
  duplicate: "none" as const,
};

const COMPLETE = {
  counterparty_name: "ACME SA",
  counterparty_cuit: "30-71234567-8",
  sales_point: 3,
  number: 12345,
  letter: "A",
  date: "2026-03-12",
  due_date: "2026-04-11",
  cae: "7412 3456 7890 12",
  cae_due_date: "2026-03-22",
  currency: "ARS",
  net_amount: 1000,
  iva_amount: 210,
  other_taxes_amount: 30,
  total_amount: 1240,
  items: [
    {
      description: "Servicio",
      quantity: 2,
      unit_price: 500,
      iva_rate: 21,
      net_amount: 1000,
      iva_amount: 210,
      total_amount: 1210,
    },
  ],
};

describe("buildPurchaseInvoiceDraft", () => {
  it("maps every header field, the items and no warnings for a clean invoice", () => {
    const draft = buildPurchaseInvoiceDraft(COMPLETE, OPTS);
    expect(draft).toMatchObject({
      supplier: SUPPLIER,
      unmatchedSupplier: null,
      kind: "factura",
      letter: "A",
      punto_venta: 3,
      numero: 12345,
      fecha: "2026-03-12",
      fch_vto_pago: "2026-04-11",
      cae_proveedor: "74123456789012",
      cae_vto_proveedor: "2026-03-22",
      imp_neto: 1000,
      imp_iva: 210,
      imp_trib: 30,
      imp_total: 1240,
      moneda: "PES",
      cotizacion: null,
      motivo_nc_nd: null,
      items: [
        {
          description: "Servicio",
          quantity: 2,
          unit_price: 500,
          iva_rate_id: 5,
        },
      ],
      // 30 is 3 % of the neto gravado: suggested as an IVA perception.
      tributes: { imp_perc_iva: 30 },
    });
    expect(draft?.warnings).toEqual([IVA_NOTE]);
  });

  it("suggests the supplier's last split on this neto, and nothing without tributes", () => {
    const draft = buildPurchaseInvoiceDraft(COMPLETE, {
      ...OPTS,
      tributeHistory: {
        imp_neto: 2000,
        split: {
          imp_perc_iva: 30,
          imp_perc_nacionales: 0,
          imp_perc_iibb: 30,
          imp_perc_municipales: 0,
          imp_impuestos_internos: 0,
        },
      },
    });
    expect(draft?.tributes).toEqual({ imp_perc_iva: 15, imp_perc_iibb: 15 });
    expect(draft?.warnings).toEqual([TRIBUTE_SUGGESTION_NOTE.history]);
    const none = buildPurchaseInvoiceDraft(
      { ...COMPLETE, other_taxes_amount: 0, total_amount: 1210 },
      OPTS,
    );
    expect(none?.tributes).toBeUndefined();
  });

  it("keeps the expense suggestion for a factura only: an NC/ND inherits its origin's", () => {
    const suggested = {
      ...OPTS,
      account: { id: "acc-ai", label: "Combustibles" },
      costCenterId: "cc-ai",
    };
    expect(buildPurchaseInvoiceDraft(COMPLETE, suggested)).toMatchObject({
      kind: "factura",
      account: { id: "acc-ai" },
      cost_center_id: "cc-ai",
    });
    for (const kind of ["credit_note", "debit_note"] as const) {
      expect(
        buildPurchaseInvoiceDraft({ ...COMPLETE, kind }, suggested),
      ).toMatchObject({ account: null, cost_center_id: null });
    }
  });

  it("produces form values the create schema accepts once channel is chosen", () => {
    const draft = buildPurchaseInvoiceDraft(COMPLETE, OPTS);
    if (!draft) throw new Error("expected a draft");
    const { patch } = draftToFormPatch(draft, { fecha: "2026-01-01" });
    const result = PurchaseInvoiceCreateSchema.safeParse({
      ...patch,
      supplier_id: patch.supplier?.id,
      channel_id: "ch1",
      // The form sends the es-AR item fields as numbers.
      items: patch.items.map((it, i) => {
        const quantity = parseArAmount(it.quantity) ?? 0;
        const unit_price = parseArAmount(it.unit_price) ?? 0;
        return {
          ...it,
          quantity,
          unit_price,
          line_neto: quantity * unit_price,
          line_iva: 0,
          line_total: quantity * unit_price,
          sort_order: i,
        };
      }),
    });
    expect(result.success).toBe(true);
  });

  it("derives the unit price from the line neto, so discounts keep qty × price", () => {
    const draft = buildPurchaseInvoiceDraft(
      {
        ...COMPLETE,
        items: [
          {
            description: "Con bonificación",
            quantity: 3,
            unit_price: 100,
            discount_pct: 10,
            iva_rate: 21,
            net_amount: 270,
          },
        ],
        net_amount: 270,
        iva_amount: 56.7,
        other_taxes_amount: 0,
        total_amount: 326.7,
      },
      OPTS,
    );
    expect(draft?.items[0]).toMatchObject({ quantity: 3, unit_price: 90 });
    expect(draft?.warnings).toEqual([]);
  });

  it("maps USD to DOL with the loaded rate, and warns without one", () => {
    const usd = { ...COMPLETE, currency: "USD" };
    expect(
      buildPurchaseInvoiceDraft(usd, { ...OPTS, usdRate: 1200 }),
    ).toMatchObject({ moneda: "DOL", cotizacion: 1200 });
    const noRate = buildPurchaseInvoiceDraft(usd, OPTS);
    expect(noRate?.cotizacion).toBeNull();
    expect(noRate?.warnings).toContain(
      "No hay cotización del dólar cargada para la fecha: completala.",
    );
  });

  it("keeps the printed counterparty when no supplier matched", () => {
    const draft = buildPurchaseInvoiceDraft(COMPLETE, {
      ...OPTS,
      supplier: null,
    });
    expect(draft?.supplier).toBeNull();
    expect(draft?.unmatchedSupplier).toEqual({
      legal_name: "ACME SA",
      cuit: "30-71234567-8",
    });
  });

  it("drops all items (header only) when one line has no price or rate", () => {
    const draft = buildPurchaseInvoiceDraft(
      {
        ...COMPLETE,
        items: [COMPLETE.items[0], { description: "Sin precio", iva_rate: 21 }],
      },
      OPTS,
    );
    expect(draft?.items).toEqual([]);
    expect(draft?.imp_total).toBe(1240);
    expect(draft?.warnings).toContain(
      "No se pudieron leer bien los ítems: se completaron solo los totales.",
    );
  });

  it("does not guess a 0% rate for a line without alícuota nor IVA amount", () => {
    const draft = buildPurchaseInvoiceDraft(
      {
        ...COMPLETE,
        items: [{ description: "X", quantity: 1, net_amount: 1000 }],
      },
      OPTS,
    );
    expect(draft?.items).toEqual([]);
  });

  it("warns when the items do not add up to the header neto", () => {
    const draft = buildPurchaseInvoiceDraft(
      { ...COMPLETE, net_amount: 900, total_amount: 1140 },
      OPTS,
    );
    expect(draft?.warnings).toContain(
      "La suma de los ítems no coincide con el neto del comprobante.",
    );
  });

  it("lists the essentials the document did not show", () => {
    const draft = buildPurchaseInvoiceDraft(
      { total_amount: 100, date: "12/03/2026" },
      OPTS,
    );
    expect(draft).toMatchObject({
      punto_venta: null,
      numero: null,
      fecha: null,
      letter: null,
    });
    expect(draft?.warnings).toContain(
      "No se encontró en el archivo: punto de venta, número, fecha.",
    );
  });

  it("flags a low-confidence reading and a likely duplicate", () => {
    const draft = buildPurchaseInvoiceDraft(COMPLETE, {
      ...OPTS,
      confidence: 0.55,
      duplicate: "found",
    });
    expect(draft?.warnings).toEqual([
      "La lectura tiene confianza baja: revisá todos los campos contra el archivo.",
      "Este comprobante parece estar ya cargado.",
      IVA_NOTE,
    ]);
  });

  it("warns when the duplicate lookup failed", () => {
    const draft = buildPurchaseInvoiceDraft(COMPLETE, {
      ...OPTS,
      duplicate: "unknown",
    });
    expect(draft?.warnings).toEqual([
      "No se pudo verificar si este comprobante ya está cargado: revisalo antes de guardar.",
      IVA_NOTE,
    ]);
  });

  it("reads an NC from the printed type, with a default motivo", () => {
    const draft = buildPurchaseInvoiceDraft(
      { ...COMPLETE, kind: "credit_note" },
      OPTS,
    );
    expect(draft).toMatchObject({
      kind: "nc",
      kind_read: true,
      motivo_nc_nd: "Según documento escaneado",
    });
  });

  it("falls back to the detected kind, unread, when no type is printed", () => {
    expect(buildPurchaseInvoiceDraft(COMPLETE, OPTS)).toMatchObject({
      kind: "factura",
      kind_read: false,
    });
    expect(
      buildPurchaseInvoiceDraft(COMPLETE, { ...OPTS, fallbackKind: "nc" }),
    ).toMatchObject({ kind: "nc", kind_read: false });
  });

  it("stores the amounts of an NC printed negative as positive", () => {
    const draft = buildPurchaseInvoiceDraft(
      {
        ...COMPLETE,
        kind: "credit_note",
        net_amount: -1000,
        iva_amount: -210,
        other_taxes_amount: -30,
        total_amount: -1240,
        items: [{ ...COMPLETE.items[0], net_amount: -1000, iva_amount: -210 }],
      },
      OPTS,
    );
    expect(draft).toMatchObject({
      imp_neto: 1000,
      imp_iva: 210,
      imp_trib: 30,
      imp_total: 1240,
      items: [{ quantity: 2, unit_price: 500, iva_rate_id: 5 }],
    });
    expect(draft?.warnings).toEqual([IVA_NOTE]);
  });

  it("keeps the lines of a factura C, without alícuota", () => {
    const draft = buildPurchaseInvoiceDraft(
      {
        ...COMPLETE,
        letter: "C",
        iva_amount: null,
        other_taxes_amount: 0,
        total_amount: 1000,
        items: [{ description: "Servicio", quantity: 1, net_amount: 1000 }],
      },
      OPTS,
    );
    expect(draft?.items).toEqual([
      {
        description: "Servicio",
        quantity: 1,
        unit_price: 1000,
        iva_rate_id: null,
      },
    ]);
    expect(draft?.warnings).toEqual([]);
  });

  it("puts the IVA of a factura B into its net, the way the buyer books it", () => {
    const draft = buildPurchaseInvoiceDraft(
      {
        ...COMPLETE,
        letter: "B",
        items: [{ description: "Servicio", quantity: 1, net_amount: 1210 }],
      },
      OPTS,
    );
    expect(draft).toMatchObject({ imp_neto: 1210, imp_iva: 0, imp_trib: 30 });
    expect(draft?.items[0]?.iva_rate_id).toBeNull();
  });

  it("passes through the suggested account and cost center", () => {
    const account = {
      id: "22222222-2222-4222-8222-222222222222",
      label: "5.1 — Fletes",
    };
    const draft = buildPurchaseInvoiceDraft(COMPLETE, {
      ...OPTS,
      account,
      costCenterId: "33333333-3333-4333-8333-333333333333",
    });
    expect(draft?.account).toEqual(account);
    expect(draft?.cost_center_id).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("returns null for a non-invoice payload", () => {
    expect(buildPurchaseInvoiceDraft("nope", OPTS)).toBeNull();
  });
});

describe("buildSalesInvoiceItems", () => {
  it("maps extracted lines and infers the rate id from amounts", () => {
    const built = buildSalesInvoiceItems({
      date: "2026-06-01",
      items: [
        {
          description: "Flete Rosario",
          quantity: 2,
          unit_price: 500,
          net_amount: 1000,
          iva_amount: 210,
        },
      ],
    });
    expect(built?.fallback).toBe(false);
    expect(built?.items).toHaveLength(1);
    expect(built?.items[0]?.iva_rate_id).toBe(5);
  });

  it("prefers the printed alícuota over inference", () => {
    const built = buildSalesInvoiceItems({
      items: [
        {
          description: "X",
          quantity: 1,
          unit_price: 100,
          iva_rate: 10.5,
          net_amount: 100,
          iva_amount: 10.5,
        },
      ],
    });
    expect(built?.items[0]?.iva_rate_id).toBe(4);
  });

  it("falls back to a single header-derived line when items don't map", () => {
    const built = buildSalesInvoiceItems({
      net_amount: 1000,
      iva_amount: 210,
      total_amount: 1210,
      items: [{ description: "Sin precio" }],
    });
    expect(built?.fallback).toBe(true);
    expect(built?.items).toHaveLength(1);
    expect(built?.items[0]?.unit_price).toBe(1000);
    expect(built?.items[0]?.iva_rate_id).toBe(5);
  });

  it("derives the neto from total - iva when the header has no neto", () => {
    const built = buildSalesInvoiceItems({
      iva_amount: 21,
      total_amount: 121,
      items: [],
    });
    expect(built?.fallback).toBe(true);
    expect(built?.items[0]?.unit_price).toBe(100);
    expect(built?.items[0]?.iva_rate_id).toBe(5);
  });

  it("returns null when not even the header has an amount", () => {
    expect(buildSalesInvoiceItems({ items: [] })).toBeNull();
    expect(buildSalesInvoiceItems("nope")).toBeNull();
  });
});
