import { describe, expect, it } from "vitest";

import {
  parseCheckKind,
  parseCurrency,
  parseLoanKind,
  parseTariffConcept,
  parseTariffUnit,
  parseIvaCondition,
  parseNumberCell,
  parsePayFrequency,
  parsePayrollKind,
  parsePeriod,
  parsePosition,
  parseVehicleType,
  parseYesNo,
} from "./cells";

describe("parseYesNo", () => {
  it("reads yes/no words and leaves anything else out", () => {
    expect(parseYesNo("Sí")).toBe(true);
    expect(parseYesNo("x")).toBe(true);
    expect(parseYesNo("No")).toBe(false);
    expect(parseYesNo("")).toBe(false);
    expect(parseYesNo("tal vez")).toBeNull();
  });
});

describe("parseIvaCondition", () => {
  it("takes labels, stored values and short forms", () => {
    expect(parseIvaCondition("Responsable Inscripto")).toBe(
      "responsable_inscripto",
    );
    expect(parseIvaCondition("RI")).toBe("responsable_inscripto");
    expect(parseIvaCondition("monotributista")).toBe("monotributo");
    expect(parseIvaCondition("Consumidor Final")).toBe("consumidor_final");
    expect(parseIvaCondition("exento")).toBe("exento");
    expect(parseIvaCondition("otro")).toBeNull();
  });
});

describe("parseVehicleType / parsePayFrequency / parsePosition", () => {
  it("maps the usual words", () => {
    expect(parseVehicleType("Camión")).toBe("camion");
    expect(parseVehicleType("Semirremolque")).toBe("semi");
    expect(parseVehicleType("Furgón")).toBe("furgon");
    expect(parseVehicleType("moto")).toBeNull();
    expect(parsePayFrequency("")).toBe("mensual");
    expect(parsePayFrequency("Semanal")).toBe("semanal");
    expect(parsePayFrequency("quincenal")).toBeNull();
  });

  it("gives a chofer the driver position and keeps other text", () => {
    expect(parsePosition("Chofer")).toBe("Chofer / Acompañante");
    expect(parsePosition("acompañante")).toBe("Chofer / Acompañante");
    expect(parsePosition("administrativo")).toBe("Administrativo");
    expect(parsePosition("Encargado")).toBe("Encargado");
    expect(parsePosition("")).toBeNull();
  });
});

describe("parsePeriod", () => {
  it("reads the period in its usual forms", () => {
    expect(parsePeriod("2025-10")).toBe("2025-10");
    expect(parsePeriod("10/2025")).toBe("2025-10");
    expect(parsePeriod("3-25")).toBe("2025-03");
    expect(parsePeriod("Octubre 2025")).toBe("2025-10");
    expect(parsePeriod("oct-25")).toBe("2025-10");
    expect(parsePeriod("setiembre de 2024")).toBe("2024-09");
    expect(parsePeriod("15/10/2025")).toBe("2025-10");
    expect(parsePeriod("13/2025")).toBeNull();
    expect(parsePeriod("Total")).toBeNull();
  });
});

describe("parsePayrollKind / parseNumberCell", () => {
  it("tells a salary from an aguinaldo", () => {
    expect(parsePayrollKind("")).toBe("monthly");
    expect(parsePayrollKind("Sueldo")).toBe("monthly");
    expect(parsePayrollKind("SAC 1er semestre")).toBe("sac");
    expect(parsePayrollKind("Aguinaldo")).toBe("sac");
    expect(parsePayrollKind("bono")).toBeNull();
  });

  it("reads es-AR and plain numbers; empty is no value", () => {
    expect(parseNumberCell("1.234,56")).toEqual({ ok: true, value: 1234.56 });
    expect(parseNumberCell("$ 1500")).toEqual({ ok: true, value: 1500 });
    expect(parseNumberCell("")).toEqual({ ok: true, value: null });
    expect(parseNumberCell("mil")).toEqual({ ok: false });
  });
});

describe("go-live cells", () => {
  it("reads tariff concepts and units", () => {
    expect(parseTariffConcept("Almacenaje")).toBe("storage");
    expect(parseTariffConcept("Descarga")).toBe("handling_out");
    expect(parseTariffConcept("Flete")).toBe("freight");
    expect(parseTariffConcept("otra cosa")).toBeNull();
    expect(parseTariffUnit("", "storage")).toBe("pallet_month");
    expect(parseTariffUnit("por pallet por día", "storage")).toBe("pallet_day");
    expect(parseTariffUnit("", "freight")).toBe("shipment");
    expect(parseTariffUnit("por kilo", "storage")).toBeNull();
  });

  it("reads currencies, check and loan kinds with their fallback", () => {
    expect(parseCurrency("", "USD")).toBe("USD");
    expect(parseCurrency("$", "USD")).toBe("ARS");
    expect(parseCurrency("U$S", "ARS")).toBe("USD");
    expect(parseCurrency("dólares", "ARS")).toBe("USD");
    expect(parseCurrency("euros", "ARS")).toBeNull();
    expect(parseCheckKind("", "echeq")).toBe("echeq");
    expect(parseCheckKind("E-Cheq", "fisico")).toBe("echeq");
    expect(parseCheckKind("Físico", "echeq")).toBe("fisico");
    expect(parseLoanKind("")).toBe("prestamo");
    expect(parseLoanKind("Leasing")).toBe("leasing");
    expect(parseLoanKind("hipoteca")).toBeNull();
  });
});
