// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { draftToFormPatch } from "../lib/purchase-invoice-draft";
import { itemNumberToInput } from "../schema";

import {
  PurchaseInvoiceItemsEditor,
  computeLine,
  parseItemNumber,
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
