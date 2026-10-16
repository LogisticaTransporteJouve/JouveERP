import { describe, expect, it } from "vitest";

import { freightInvoiceDates } from "./freight-invoice";

describe("freightInvoiceDates", () => {
  it("never lets the payment fall due before the voucher date", () => {
    const dates = freightInvoiceDates(
      { delivery_date: "2026-10-02", scheduled_date: "2026-10-01" },
      "2026-10-16",
    );
    expect(dates).toEqual({
      fecha: "2026-10-16",
      fch_serv_desde: "2026-10-02",
      fch_serv_hasta: "2026-10-02",
      fch_vto_pago: "2026-10-16",
    });
  });

  it("keeps a future scheduled day as service day and due date", () => {
    expect(
      freightInvoiceDates(
        { delivery_date: null, scheduled_date: "2026-10-20" },
        "2026-10-16",
      ).fch_vto_pago,
    ).toBe("2026-10-20");
  });

  it("falls back to today when the shipment has no dates", () => {
    expect(
      freightInvoiceDates(
        { delivery_date: null, scheduled_date: null },
        "2026-10-16",
      ).fch_serv_desde,
    ).toBe("2026-10-16");
  });
});
