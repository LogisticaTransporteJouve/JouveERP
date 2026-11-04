// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { draftToFormPatch } from "../lib/purchase-invoice-draft";
import { itemNumberToInput } from "../schema";

import {
  PurchaseInvoiceItemsEditor,
  computeLine,
  computeTotals,
  itemsToSave,
  parseItemNumber,
  storedItemToDraft,
  type PurchaseInvoiceItemDraft,
} from "./purchase-invoice-items-editor";

// Radix measures its controls; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

/** What the purchase form sends for an item and the line it computes. */
function saved(it: PurchaseInvoiceItemDraft) {
  return {
    quantity: parseItemNumber(it.quantity),
    unit_price: parseItemNumber(it.unit_price),
    line_neto: computeLine(it).line_neto,
  };
}

const ITEM: PurchaseInvoiceItemDraft = {
  description: "Repuesto",
  quantity: "1",
  unit_price: "0",
  iva_rate_id: 5,
};

/** The editor's state, last value first. */
const changes: PurchaseInvoiceItemDraft[][] = [];

function Harness({ initial }: { initial: PurchaseInvoiceItemDraft[] }) {
  const [items, setItems] = useState(initial);
  return (
    <PurchaseInvoiceItemsEditor
      items={items}
      onChange={(next) => {
        changes.unshift(next);
        setItems(next);
      }}
    />
  );
}

function field(label: string): HTMLInputElement {
  const el = screen.getByLabelText(label);
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

describe("purchase items: quantity and unit price", () => {
  it("prefills a stored item in es-AR and saves it unchanged", () => {
    const stored = { quantity: 2, unit_price: 1234.56 };
    const prefilled = {
      ...ITEM,
      quantity: itemNumberToInput(stored.quantity),
      unit_price: itemNumberToInput(stored.unit_price),
    };
    render(<Harness initial={[prefilled]} />);
    expect(field("Precio unitario").value).toBe("1.234,56");
    expect(saved(prefilled)).toEqual({ ...stored, line_neto: 2469.12 });
  });

  it("keeps four decimals of a stored unit price", () => {
    expect(itemNumberToInput(1234.5678)).toBe("1.234,5678");
    expect(parseItemNumber(itemNumberToInput(1234.5678))).toBe(1234.5678);
  });

  it("reads a typed dot as the decimal mark and saves a typed 1.234,56 as 1234.56", () => {
    render(<Harness initial={[ITEM]} />);
    fireEvent.change(field("Precio unitario"), {
      target: { value: "1234.56" },
    });
    expect(field("Precio unitario").value).toBe("1.234,56");
    fireEvent.change(field("Precio unitario"), {
      target: { value: "1.234,56" },
    });
    expect(saved(changes[0]![0]!)).toEqual({
      quantity: 1,
      unit_price: 1234.56,
      line_neto: 1234.56,
    });
  });

  it("prefills a scanned document's items the same way", () => {
    const { patch } = draftToFormPatch(
      {
        supplier: null,
        unmatchedSupplier: null,
        kind: "factura",
        kind_read: false,
        letter: null,
        punto_venta: null,
        numero: null,
        fecha: null,
        fch_vto_pago: null,
        cae_proveedor: null,
        cae_vto_proveedor: null,
        imp_neto: null,
        imp_iva: null,
        imp_trib: null,
        imp_total: null,
        moneda: "PES",
        cotizacion: null,
        motivo_nc_nd: null,
        items: [
          {
            description: "Repuesto",
            quantity: 2,
            unit_price: 1234.56,
            iva_rate_id: 5,
          },
        ],
        account: null,
        cost_center_id: null,
        warnings: [],
      },
      { fecha: "2026-10-16" },
    );
    expect(saved(patch.items[0]!)).toEqual({
      quantity: 2,
      unit_price: 1234.56,
      line_neto: 2469.12,
    });
  });
});

// An ARCA A voucher without a breakdown: one 21 % line whose IVA is ARCA's
// (21.050), not round(100.000 × 21 %).
const ARCA_LINE = {
  description: "Servicio",
  quantity: 1,
  unit_price: 100000,
  iva_rate_id: 5 as const,
  line_neto: 100000,
  line_iva: 21050,
  line_total: 121050,
};

describe("purchase items: stored figures on edit", () => {
  it("re-saves an untouched stored line with its stored neto and IVA", () => {
    const draft = storedItemToDraft(ARCA_LINE);
    expect(computeTotals([draft])).toEqual({
      imp_neto: 100000,
      imp_iva: 21050,
      imp_total_lines: 121050,
    });
    expect(itemsToSave({ with_items: true, items: [draft] }, 1)).toEqual([
      { ...ARCA_LINE, sort_order: 0 },
    ]);
  });

  it("keeps them when only the description changes", () => {
    const draft = { ...storedItemToDraft(ARCA_LINE), description: "Flete" };
    expect(computeLine(draft).line_iva).toBe(21050);
  });

  it("recomputes a line whose quantity, price or rate is edited", () => {
    const draft = storedItemToDraft(ARCA_LINE);
    expect(computeLine({ ...draft, iva_rate_id: 4 }).line_iva).toBe(10500);
    expect(computeLine({ ...draft, quantity: "2" }).line_iva).toBe(42000);
    expect(computeLine({ ...draft, unit_price: "100.000,01" }).line_iva).toBe(
      21000,
    );
  });
});

describe("purchase items: what a save sends", () => {
  const off = { with_items: false, items: [] };

  it("sends nothing while the stored items load or after their read failed", () => {
    expect(itemsToSave(off, null)).toBeUndefined();
  });

  it("clears the stored items when the user turned «con detalle» off", () => {
    expect(itemsToSave(off, 2)).toEqual([]);
  });

  it("sends nothing for a purchase that had no items", () => {
    expect(itemsToSave(off, 0)).toBeUndefined();
  });
});
