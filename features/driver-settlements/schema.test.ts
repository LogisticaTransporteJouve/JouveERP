import { describe, expect, it } from "vitest";

import {
  DRIVER_SETTLEMENT_STATUSES,
  DRIVER_SETTLEMENT_STATUS_LABELS,
  DriverSettlementSaveSchema,
  differenceNote,
  formatDriverSettlementNumber,
  groupPendingByDriver,
  isDriverSettlementStatus,
  settlementDifference,
  type CodPendingShipment,
} from "./schema";

const driver_id = "11111111-1111-4111-8111-111111111111";
const shipment = "22222222-2222-4222-8222-222222222222";
const account = "33333333-3333-4333-8333-333333333333";

describe("DriverSettlementSaveSchema", () => {
  const base = {
    driver_id,
    settlement_date: "2026-11-03",
    notes: "",
    items: [
      {
        shipment_id: shipment,
        note: "",
        lines: [
          {
            account_id: account,
            amount: "15000.5",
            reference: "",
            check_number: "",
            check_due_date: "",
          },
        ],
      },
    ],
  };

  it("coerces amounts and stores empty optionals as null", () => {
    const r = DriverSettlementSaveSchema.parse(base);
    const line = r.items[0]!.lines[0]!;
    expect(line.amount).toBe(15000.5);
    expect(line.reference).toBeNull();
    expect(line.check_due_date).toBeNull();
    expect(r.notes).toBeNull();
  });

  it("takes a carga with nothing handed in", () => {
    const r = DriverSettlementSaveSchema.safeParse({
      ...base,
      items: [{ shipment_id: shipment, note: "No pagó", lines: [] }],
    });
    expect(r.success).toBe(true);
  });

  it("refuses a zero line and a repeated carga", () => {
    expect(
      DriverSettlementSaveSchema.safeParse({
        ...base,
        items: [
          {
            shipment_id: shipment,
            lines: [{ account_id: account, amount: 0 }],
          },
        ],
      }).success,
    ).toBe(false);
    const twice = DriverSettlementSaveSchema.safeParse({
      ...base,
      items: [base.items[0], base.items[0]],
    });
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0]?.message).toBe(
      "Una carga está dos veces en la rendición.",
    );
  });

  it("needs a driver and at least one carga", () => {
    expect(
      DriverSettlementSaveSchema.safeParse({ ...base, driver_id: "" }).success,
    ).toBe(false);
    expect(
      DriverSettlementSaveSchema.safeParse({ ...base, items: [] }).success,
    ).toBe(false);
  });
});

describe("totals", () => {
  it("signs the difference from the driver's side", () => {
    expect(settlementDifference(1000, 900)).toBe(-100);
    expect(settlementDifference(1000, 1000.004)).toBe(0);
    expect(settlementDifference(0.1 + 0.2, 0.3)).toBe(0);
  });

  it("groups pending cargas per driver, with drafts and no driver last", () => {
    const ship = (
      id: string,
      driver: string | null,
      amount: number,
    ): CodPendingShipment => ({
      shipment_id: id,
      driver_id: driver,
      driver_name: driver ? `Chofer ${driver}` : null,
      remito_number: null,
      client_name: "Cliente",
      delivery_date: "2026-11-01",
      origin: null,
      destination: null,
      cod_amount: amount,
    });
    const rows = groupPendingByDriver(
      [ship("a", "b", 100.1), ship("b", "b", 0.2), ship("c", null, 50)],
      [
        { driver_id: "b", driver_name: "Chofer b" },
        { driver_id: "z", driver_name: "Ana" },
      ],
    );
    expect(rows).toEqual([
      { driver_id: "z", driver_name: "Ana", cargas: 0, amount: 0, drafts: 1 },
      {
        driver_id: "b",
        driver_name: "Chofer b",
        cargas: 2,
        amount: 100.3,
        drafts: 1,
      },
      {
        driver_id: null,
        driver_name: "Sin chofer",
        cargas: 1,
        amount: 50,
        drafts: 0,
      },
    ]);
  });
});

describe("labels", () => {
  it("labels every status and prints the number", () => {
    for (const s of DRIVER_SETTLEMENT_STATUSES) {
      expect(DRIVER_SETTLEMENT_STATUS_LABELS[s]).toBeTruthy();
    }
    expect(isDriverSettlementStatus("confirmed")).toBe(true);
    expect(isDriverSettlementStatus("posted")).toBe(false);
    expect(formatDriverSettlementNumber(7)).toBe("N° 7");
    expect(formatDriverSettlementNumber(null)).toBe("Borrador");
  });
});

describe("differenceNote", () => {
  it("says who bears a resolved difference", () => {
    expect(differenceNote("driver", { kind: "advance", amount: 100 })).toBe(
      "Faltante cargado en la cuenta corriente del chofer: $ 100,00, con un recibo que saldó al cliente.",
    );
    expect(differenceNote("driver", { kind: "charge", amount: 100 })).toBe(
      "Faltante cargado en la cuenta corriente del chofer: $ 100,00.",
    );
    expect(differenceNote("driver", { kind: "payment", amount: 50 })).toBe(
      "Sobrante acreditado en la cuenta corriente del chofer: $ 50,00.",
    );
    expect(differenceNote("client", null)).toBe(
      "Diferencia a cargo del cliente: queda en su cuenta corriente.",
    );
    expect(differenceNote(null, null)).toBeNull();
  });
});
