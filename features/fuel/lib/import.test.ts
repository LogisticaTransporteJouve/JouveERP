import { describe, expect, it } from "vitest";

import {
  buildImportRows,
  findHeaderRow,
  fuelLoadKey,
  matchVehicle,
  missingFields,
  suggestMapping,
  type ImportVehicle,
} from "./import";

const VEHICLES: ImportVehicle[] = [
  { id: "v1", patente: "AB 123 CD", fuel_card: "7069001234567890" },
  { id: "v2", patente: "AAA111", fuel_card: "7069009999994321" },
  { id: "v3", patente: "AAA222", fuel_card: null },
];

describe("suggestMapping / findHeaderRow", () => {
  it("finds the header under title lines and maps provider aliases", () => {
    const rows = [
      ["Resumen de consumos YPF en Ruta"],
      ["Período: 10/2026"],
      [
        "Fecha Transacción",
        "Dominio",
        "Nro. Tarjeta",
        "Producto",
        "Cantidad Lts",
        "Importe con impuestos",
        "Razón Social Estación",
        "Odómetro declarado",
      ],
    ];
    const header = findHeaderRow(rows, "ypf_en_ruta");
    expect(header).toBe(2);
    expect(suggestMapping(rows[2] ?? [], "ypf_en_ruta")).toEqual({
      date: 0,
      patente: 1,
      card: 2,
      product: 3,
      liters: 4,
      amount: 5,
      station: 6,
      odometer: 7,
    });
  });

  it("maps a header that starts with an alias and uses each column once", () => {
    expect(
      suggestMapping(
        ["Fecha hora", "Patente", "Litros (lts)", "Total"],
        "other",
      ),
    ).toEqual({ date: 0, patente: 1, liters: 2, amount: 3 });
  });

  it("returns -1 without a recognisable header", () => {
    expect(
      findHeaderRow(
        [
          ["a", "b"],
          ["1", "2"],
        ],
        "axion_card",
      ),
    ).toBe(-1);
  });

  it("needs date, liters, amount and a patente or card", () => {
    expect(missingFields({ date: 0, liters: 1, amount: 2, card: 3 })).toEqual(
      [],
    );
    expect(missingFields({ liters: 1 })).toEqual(["date", "amount", "patente"]);
  });
});

describe("matchVehicle", () => {
  it("matches the patente ignoring spaces, dashes and case", () => {
    expect(
      matchVehicle({ patente: "ab-123-cd", card: null }, VEHICLES),
    ).toEqual({ vehicleId: "v1", patente: "AB 123 CD" });
  });

  it("falls back to the fuel card, exact or masked by its last 4 digits", () => {
    expect(
      matchVehicle({ patente: "ZZZ999", card: "7069 0099 9999 4321" }, VEHICLES)
        ?.vehicleId,
    ).toBe("v2");
    expect(
      matchVehicle({ patente: null, card: "XXXX-XXXX-XXXX-7890" }, VEHICLES)
        ?.vehicleId,
    ).toBe("v1");
  });

  it("does not guess an unmasked card that matches nothing", () => {
    expect(
      matchVehicle({ patente: null, card: "1111222233334321" }, VEHICLES),
    ).toBeNull();
  });
});

describe("buildImportRows", () => {
  const mapping = { date: 0, patente: 1, liters: 2, amount: 3, station: 4 };

  it("flags ready, duplicate, repeated, unmatched and unreadable rows and skips footers", () => {
    const existing = new Set([
      fuelLoadKey({
        vehicle_id: "v3",
        load_date: "2026-10-02",
        amount: 1000,
        liters: 10,
      }),
    ]);
    const rows = buildImportRows({
      rows: [
        ["01/10/2026", "AAA111", "250,5", "$ 450.900,00", "YPF Ruta 3"],
        ["02/10/2026", "AAA222", "10", "1.000", "YPF"],
        ["01/10/2026", "AAA111", "250.5", "450900", "YPF Ruta 3"],
        ["03/10/2026", "XXX000", "50", "9000", ""],
        ["04/10/2026", "AAA111", "0", "100", ""],
        ["fecha mala", "AAA111", "10", "100", ""],
        ["Total", "", "310,5", "461.900", ""],
      ],
      firstLine: 5,
      mapping,
      vehicles: VEHICLES,
      existing,
    });
    expect(rows.map((r) => [r.line, r.status])).toEqual([
      [5, "ready"],
      [6, "duplicate"],
      [7, "duplicate"],
      [8, "no_vehicle"],
      [9, "invalid"],
      [10, "invalid"],
    ]);
    expect(rows[0]).toMatchObject({
      vehicle_id: "v2",
      patente: "AAA111",
      load_date: "2026-10-01",
      liters: 250.5,
      amount: 450900,
      station: "YPF Ruta 3",
      reason: null,
    });
    expect(rows[2]?.reason).toBe("Repetida en el archivo.");
  });
});
