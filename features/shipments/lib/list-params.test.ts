import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHIPMENT_LIST_PARAMS,
  parseShipmentListParams,
  shipmentListFilter,
  shipmentListParamsToUrl,
} from "./list-params";

const CLIENT = "00000000-0000-4000-8000-0000000000c1";

describe("parseShipmentListParams", () => {
  it("reads every filter from the URL", () => {
    expect(
      parseShipmentListParams({
        q: "acme",
        estado: "in_progress,bogus,not_started,in_progress",
        period: "this_month",
        cliente: CLIENT,
        viaje: "sin",
      }),
    ).toEqual({
      query: "acme",
      statuses: ["not_started", "in_progress"],
      period: { preset: "this_month", from: null, to: null },
      clientId: CLIENT,
      trip: "sin",
    });
  });

  it("drops invalid values", () => {
    expect(
      parseShipmentListParams({
        estado: "x",
        cliente: "acme",
        viaje: "todas",
      }),
    ).toEqual(DEFAULT_SHIPMENT_LIST_PARAMS);
  });

  it("round-trips through the URL", () => {
    const params = parseShipmentListParams({
      estado: "reprogrammed",
      from: "2026-11-01",
      to: "2026-11-10",
      viaje: "asignada",
    });
    const url = shipmentListParamsToUrl(params);
    expect(url).toMatchObject({
      estado: "reprogrammed",
      period: "custom",
      from: "2026-11-01",
      to: "2026-11-10",
      viaje: "asignada",
      cliente: null,
    });
    const back = Object.fromEntries(
      Object.entries(url).flatMap(([k, v]) => (v === null ? [] : [[k, v]])),
    );
    expect(parseShipmentListParams(back)).toEqual(params);
  });
});

describe("shipmentListFilter", () => {
  it("is empty with no filter, so the page and the table share a key", () => {
    expect(shipmentListFilter(DEFAULT_SHIPMENT_LIST_PARAMS)).toEqual({});
  });

  it("maps each filter to the action's input", () => {
    expect(
      shipmentListFilter(
        {
          query: "ignored",
          statuses: ["delivered", "cancelled"],
          period: { preset: "today", from: null, to: null },
          clientId: CLIENT,
          trip: "sin",
        },
        "2026-11-12",
      ),
    ).toEqual({
      statuses: ["delivered", "cancelled"],
      from: "2026-11-12",
      to: "2026-11-12",
      clientId: CLIENT,
      assigned: false,
    });
  });

  it("maps «Asignada» to assigned true", () => {
    expect(
      shipmentListFilter({ ...DEFAULT_SHIPMENT_LIST_PARAMS, trip: "asignada" }),
    ).toEqual({ assigned: true });
  });
});
