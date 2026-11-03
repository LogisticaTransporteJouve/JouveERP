import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ReceiptDocument, type ReceiptTemplateData } from "./receipt-template";
import { VoucherDocument } from "./voucher-template";

const DATA: ReceiptTemplateData = {
  emisor: {
    legal_name: "DZ & Sons S.A.",
    cuit: "30-71234567-8",
    address: null,
    division_label: "Logística Jouve",
  },
  receptor: { legal_name: "Cliente SA", cuit: null, iva_condition_label: null },
  punto_venta: 1,
  numero: 12,
  fecha: "2026-11-03",
  moneda: "ARS",
  payment_lines: [],
  retentions: [],
  allocations: [],
  total_amount: 100,
  payment_sum: 100,
  retention_sum: 0,
  allocated_sum: 0,
  a_cuenta: 100,
  notes: null,
  status: "issued",
};

type VoucherProps = Parameters<typeof VoucherDocument>[0];

function isVoucher(el: unknown): el is ReactElement<VoucherProps> {
  return isValidElement(el) && el.type === VoucherDocument;
}

/** Every string under a tree of react-pdf primitives. */
function texts(node: ReactNode): string[] {
  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }
  if (Array.isArray(node)) return node.flatMap(texts);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return texts(node.props.children);
}

describe("receipt PDF", () => {
  it("numbers the receipt with X and shows the X letter box", () => {
    const el = ReceiptDocument({ data: DATA });
    expect(isVoucher(el)).toBe(true);
    if (!isVoucher(el)) return;
    expect(el.props.number).toBe("X0001-00000012");
    expect(el.props.letter).toBe("X");

    const rendered = texts(VoucherDocument(el.props));
    expect(rendered).toContain("X");
    expect(rendered).toContain("Documento no válido como factura");
    expect(rendered).toContain("X0001-00000012");
    expect(rendered.some((t) => t.startsWith("R0001"))).toBe(false);
  });
});
