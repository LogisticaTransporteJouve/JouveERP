import { describe, expect, it } from "vitest";

import {
  FREIGHT_SETTLEMENT_STATUSES,
  FREIGHT_SETTLEMENT_STATUS_LABELS,
  FreightCandidatesSchema,
  FreightSettlementInvoiceSchema,
  FreightSettlementSaveSchema,
  formatRemitoR,
  formatSettlementNumber,
  freightItemDescription,
  hasRDocument,
  isFreightPriceSource,
  isFreightSettlementChannel,
  isFreightSettlementStatus,
  settlementDocumentLabel,
  settlementNextStep,
  settlementNumberLabel,
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

  const base = {
    status: "confirmed" as const,
    numero: null,
    channel: null,
    remito_pos: null,
    remito_number: null,
    client_is_fiscal: true,
    invoice_number: null,
    invoice_id: null,
  };

  it("prints the Remito R as R<pos>-<numero>", () => {
    expect(formatRemitoR(9002, 1)).toBe("R9002-00000001");
    const fiscal = {
      ...base,
      channel: "fiscal" as const,
      remito_pos: 9002,
      remito_number: 15,
    };
    expect(settlementNumberLabel(fiscal)).toBe("R9002-00000015");
    expect(settlementDocumentLabel(fiscal)).toBe("Remito R9002-00000015");
    expect(hasRDocument(fiscal)).toBe(true);
  });

  it("keeps the legacy R- number of a liquidación confirmed before the remito R", () => {
    const legacy = { ...base, numero: 12 };
    expect(settlementNumberLabel(legacy)).toBe("R-00000012");
    expect(settlementDocumentLabel(legacy)).toBe("Liquidación R-00000012");
    expect(hasRDocument(legacy)).toBe(true);
    // A legacy one follows its client's side for the next step.
    expect(settlementNextStep(legacy)).toBe("invoice");
    expect(settlementNextStep({ ...legacy, client_is_fiscal: false })).toBe(
      "issue_internal",
    );
  });

  it("names an internal liquidación by its remito interno X", () => {
    const internal = {
      ...base,
      channel: "internal" as const,
      client_is_fiscal: false,
    };
    expect(settlementNumberLabel(internal)).toBe("Sin remito");
    expect(settlementDocumentLabel(internal)).toBeNull();
    expect(hasRDocument(internal)).toBe(false);
    const issued = {
      ...internal,
      status: "invoiced" as const,
      invoice_id: "inv1",
      invoice_number: "X9001-00000004",
    };
    expect(settlementNumberLabel(issued)).toBe("X9001-00000004");
    expect(settlementDocumentLabel(issued)).toBe(
      "Remito interno X9001-00000004",
    );
    expect(settlementNextStep(issued)).toBeNull();
  });

  it("offers each side its next step", () => {
    const draft = { ...base, status: "draft" as const };
    expect(settlementNumberLabel(draft)).toBe("Borrador");
    expect(settlementNextStep(draft)).toBe("confirm");
    expect(settlementNextStep({ ...draft, client_is_fiscal: false })).toBe(
      "issue_internal",
    );
    const remitoEmitted = {
      ...base,
      channel: "fiscal" as const,
      remito_pos: 9002,
      remito_number: 1,
    };
    expect(settlementNextStep(remitoEmitted)).toBe("invoice");
    expect(
      settlementNextStep({ ...base, status: "cancelled" as const }),
    ).toBeNull();
    expect(isFreightSettlementChannel("internal")).toBe(true);
    expect(isFreightSettlementChannel("legacy")).toBe(false);
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
