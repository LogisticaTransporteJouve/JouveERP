import { describe, expect, it } from "vitest";

import {
  formatReceiptNumber,
  isReceiptStatus,
  ReceiptCreateSchema,
  ReceiptUpdateSchema,
} from "./schema";

const CLIENT_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const ACCOUNT_UUID = "0e8400e2-9b8a-4dca-9c44-bb52a8e8feac";
const COMPROBANTE_UUID = "1c6a4d3a-c7c8-4d6b-8a0f-2c1d3e4f5a6b";
const RECEIPT_UUID = "2d8b6e9f-3c1a-4f5e-b6a7-8c9d0e1f2a3b";

const validBase = {
  channel_id: "jouve_fiscal",
  numero: 1,
  client_id: CLIENT_UUID,
  receipt_date: "2026-05-10",
  total_amount: 100,
  currency: "ARS" as const,
  notes: "",
  payment_lines: [
    {
      account_id: ACCOUNT_UUID,
      amount: 100,
      reference: "",
    },
  ],
  allocations: [],
};

describe("formatReceiptNumber", () => {
  it("zero-pads POS to 4 and number to 8 with R prefix", () => {
    expect(formatReceiptNumber(3, 1)).toBe("R0003-00000001");
    expect(formatReceiptNumber(99, 12345678)).toBe("R0099-12345678");
  });
});

describe("isReceiptStatus", () => {
  it("accepts issued and canceled, rejects others", () => {
    expect(isReceiptStatus("issued")).toBe(true);
    expect(isReceiptStatus("canceled")).toBe(true);
    expect(isReceiptStatus("draft")).toBe(false);
    expect(isReceiptStatus(undefined)).toBe(false);
  });
});

describe("ReceiptCreateSchema", () => {
  it("accepts a valid receipt", () => {
    const r = ReceiptCreateSchema.safeParse(validBase);
    expect(r.success).toBe(true);
  });

  it("rejects when payment_lines + retentions sum != total_amount", () => {
    const r = ReceiptCreateSchema.safeParse({
      ...validBase,
      payment_lines: [
        {
          account_id: ACCOUNT_UUID,
          amount: 50,
          reference: "",
        },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues[0]?.message ?? "";
      expect(msg).toMatch(/no coincide con el total/);
    }
  });

  it("accepts a receipt where payment + retentions = total", () => {
    const r = ReceiptCreateSchema.safeParse({
      ...validBase,
      total_amount: 100,
      payment_lines: [
        {
          account_id: ACCOUNT_UUID,
          amount: 98,
          reference: "",
        },
      ],
      retentions: [
        {
          kind: "retencion",
          tax_type: "ganancias",
          certificate_number: "SICORE-12345",
          certificate_date: "2026-05-10",
          amount: 2,
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects retention with empty certificate_number", () => {
    const r = ReceiptCreateSchema.safeParse({
      ...validBase,
      total_amount: 100,
      payment_lines: [{ account_id: ACCOUNT_UUID, amount: 90, reference: "" }],
      retentions: [
        {
          kind: "retencion",
          tax_type: "iva",
          certificate_number: "",
          certificate_date: "2026-05-10",
          amount: 10,
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects when allocations sum exceeds total_amount", () => {
    const r = ReceiptCreateSchema.safeParse({
      ...validBase,
      allocations: [
        {
          invoice_id: COMPROBANTE_UUID,
          amount_applied: 200,
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("requires at least one payment line", () => {
    const r = ReceiptCreateSchema.safeParse({
      ...validBase,
      payment_lines: [],
    });
    expect(r.success).toBe(false);
  });

  it("normalises amount strings with commas", () => {
    const r = ReceiptCreateSchema.safeParse({
      ...validBase,
      total_amount: "100,50",
      payment_lines: [
        {
          account_id: ACCOUNT_UUID,
          amount: "100,50",
          reference: "",
        },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.total_amount).toBe(100.5);
      expect(r.data.payment_lines[0]?.amount).toBe(100.5);
    }
  });

  it("allows allocations sum less than total (a cuenta)", () => {
    const r = ReceiptCreateSchema.safeParse({
      ...validBase,
      total_amount: 100,
      allocations: [
        {
          invoice_id: COMPROBANTE_UUID,
          amount_applied: 60,
        },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("ReceiptUpdateSchema", () => {
  it("validates the same sum constraints as create", () => {
    const r = ReceiptUpdateSchema.safeParse({
      id: RECEIPT_UUID,
      receipt_date: "2026-05-10",
      total_amount: 100,
      notes: null,
      payment_lines: [
        {
          account_id: ACCOUNT_UUID,
          amount: 80,
          reference: "",
        },
      ],
      allocations: [],
    });
    expect(r.success).toBe(false);
  });
});
