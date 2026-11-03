import { describe, expect, it } from "vitest";

import {
  FREIGHT_SETTLEMENT_STATUSES,
  FREIGHT_SETTLEMENT_STATUS_LABELS,
  FreightCandidatesSchema,
  FreightSettlementInvoiceSchema,
  FreightSettlementSaveSchema,
  formatSettlementNumber,
  freightItemDescription,
  isFreightPriceSource,
  isFreightSettlementStatus,
} from "./schema";

const client_id = "11111111-1111-4111-8111-111111111111";
const shipment = "22222222-2222-4222-8222-222222222222";

describe("FreightSettlementSaveSchema", () => {
  const base = {
    client_id,
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    shipment_ids: [shipment],
    notes: "",
  };

  it("stores empty notes as null", () => {
    const r = FreightSettlementSaveSchema.parse(base);
    expect(r.notes).toBeNull();
    expect(r.id).toBeUndefined();
  });

  it("needs at least one carga", () => {
    const r = FreightSettlementSaveSchema.safeParse({
      ...base,
      shipment_ids: [],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Elegí al menos una carga.");
  });

  it("refuses a period that ends before it starts", () => {
    const r = FreightSettlementSaveSchema.safeParse({
      ...base,
      period_end: "2026-09-30",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["period_end"]);
  });

  it("takes a one-day period", () => {
    expect(
      FreightSettlementSaveSchema.safeParse({
        ...base,
        period_end: base.period_start,
      }).success,
    ).toBe(true);
  });
});

describe("FreightCandidatesSchema", () => {
  it("needs a client", () => {
    const r = FreightCandidatesSchema.safeParse({
      client_id: "",
      period_start: "2026-10-01",
      period_end: "2026-10-31",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Elegí un cliente.");
  });
});

describe("FreightSettlementInvoiceSchema", () => {
  it("coerces the point of sale and needs a channel", () => {
    const ok = FreightSettlementInvoiceSchema.parse({
      id: shipment,
      channel_id: "jouve_fiscal",
      punto_venta: "3",
    });
    expect(ok.punto_venta).toBe(3);
    expect(
      FreightSettlementInvoiceSchema.safeParse({
        id: shipment,
        channel_id: "",
        punto_venta: 3,
      }).success,
    ).toBe(false);
  });
});

describe("formatting", () => {
  it("prints the R number, or Borrador before confirmation", () => {
    expect(formatSettlementNumber(12)).toBe("R-00000012");
    expect(formatSettlementNumber(null)).toBe("Borrador");
  });

  it("describes each invoice line by route, remito and day", () => {
    expect(
      freightItemDescription({
        origin: "Rosario",
        destination: "Córdoba",
        remito_number: "0001-123",
        service_date: "2026-10-12",
      }),
    ).toBe("Flete Rosario → Córdoba · Remito 0001-123 · 12/10/2026");
    expect(
      freightItemDescription({
        origin: null,
        destination: null,
        remito_number: null,
        service_date: null,
      }),
    ).toBe("Flete");
  });

  it("labels every status and narrows unknown values", () => {
    for (const s of FREIGHT_SETTLEMENT_STATUSES) {
      expect(FREIGHT_SETTLEMENT_STATUS_LABELS[s]).toBeTruthy();
    }
    expect(isFreightSettlementStatus("invoiced")).toBe(true);
    expect(isFreightSettlementStatus("void")).toBe(false);
    expect(isFreightPriceSource("tariff")).toBe(true);
    expect(isFreightPriceSource("manual")).toBe(false);
  });
});
