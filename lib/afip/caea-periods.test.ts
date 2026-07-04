import { describe, expect, it } from "vitest";

import {
  afipDateToIso,
  nextQuincena,
  quincenaEnd,
  quincenaOf,
  quincenaStart,
  toAfipDateTimeAR,
} from "./caea-periods";

describe("quincenaOf", () => {
  it("día 1-15 → orden 1; 16-fin → orden 2", () => {
    expect(quincenaOf("2026-07-01")).toEqual({ periodo: 202607, orden: 1 });
    expect(quincenaOf("2026-07-15")).toEqual({ periodo: 202607, orden: 1 });
    expect(quincenaOf("2026-07-16")).toEqual({ periodo: 202607, orden: 2 });
    expect(quincenaOf("2026-07-31")).toEqual({ periodo: 202607, orden: 2 });
  });
});

describe("quincenaStart / quincenaEnd", () => {
  it("orden 1 = 1 al 15", () => {
    expect(quincenaStart({ periodo: 202607, orden: 1 })).toBe("2026-07-01");
    expect(quincenaEnd({ periodo: 202607, orden: 1 })).toBe("2026-07-15");
  });

  it("orden 2 = 16 al fin de mes (bisiesto incluido)", () => {
    expect(quincenaStart({ periodo: 202607, orden: 2 })).toBe("2026-07-16");
    expect(quincenaEnd({ periodo: 202607, orden: 2 })).toBe("2026-07-31");
    expect(quincenaEnd({ periodo: 202606, orden: 2 })).toBe("2026-06-30");
    expect(quincenaEnd({ periodo: 202802, orden: 2 })).toBe("2028-02-29");
    expect(quincenaEnd({ periodo: 202702, orden: 2 })).toBe("2027-02-28");
  });
});

describe("nextQuincena", () => {
  it("avanza dentro del mes y cruza diciembre", () => {
    expect(nextQuincena({ periodo: 202607, orden: 1 })).toEqual({
      periodo: 202607,
      orden: 2,
    });
    expect(nextQuincena({ periodo: 202607, orden: 2 })).toEqual({
      periodo: 202608,
      orden: 1,
    });
    expect(nextQuincena({ periodo: 202612, orden: 2 })).toEqual({
      periodo: 202701,
      orden: 1,
    });
  });
});

describe("afipDateToIso", () => {
  it("yyyymmdd → YYYY-MM-DD", () => {
    expect(afipDateToIso("20260716")).toBe("2026-07-16");
  });
});

describe("toAfipDateTimeAR", () => {
  it("convierte a hora argentina yyyymmddhhmiss", () => {
    // 2026-07-04T15:30:00Z = 12:30:00 en ART (UTC-3).
    expect(toAfipDateTimeAR("2026-07-04T15:30:00.000Z")).toBe("20260704123000");
  });

  it("cruza medianoche hacia el día anterior en ART", () => {
    // 2026-07-05T01:10:05Z = 2026-07-04 22:10:05 ART.
    expect(toAfipDateTimeAR("2026-07-05T01:10:05.000Z")).toBe("20260704221005");
  });
});
