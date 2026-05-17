import { describe, expect, it } from "vitest";

import {
  dateToIso,
  isRangePreset,
  isoToDate,
  resolveRange,
  todayIsoLocal,
} from "./date-range";

describe("todayIsoLocal", () => {
  it("devuelve YYYY-MM-DD válido", () => {
    expect(todayIsoLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("coincide con el día local actual", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(todayIsoLocal()).toBe(expected);
  });
});

describe("dateToIso", () => {
  it("formatea una Date como YYYY-MM-DD en zona local", () => {
    const d = new Date(2026, 4, 17); // 17 may 2026 (mes 0-indexed)
    expect(dateToIso(d)).toBe("2026-05-17");
  });

  it("pad de mes y día con ceros a la izquierda", () => {
    const d = new Date(2026, 0, 3); // 3 ene 2026
    expect(dateToIso(d)).toBe("2026-01-03");
  });
});

describe("isoToDate", () => {
  it("convierte ISO válido a Date local", () => {
    const d = isoToDate("2026-05-17");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(4);
    expect(d?.getDate()).toBe(17);
  });

  it("devuelve undefined para string vacío", () => {
    expect(isoToDate("")).toBeUndefined();
  });

  it("devuelve undefined para input malformado", () => {
    expect(isoToDate("abc")).toBeUndefined();
    expect(isoToDate("2026")).toBeUndefined();
    expect(isoToDate("2026-05")).toBeUndefined();
  });

  it("round-trip dateToIso ↔ isoToDate preserva la fecha", () => {
    const original = new Date(2026, 6, 4);
    const round = isoToDate(dateToIso(original));
    expect(round?.getFullYear()).toBe(original.getFullYear());
    expect(round?.getMonth()).toBe(original.getMonth());
    expect(round?.getDate()).toBe(original.getDate());
  });
});

describe("isRangePreset", () => {
  it("acepta valores válidos", () => {
    expect(isRangePreset("current_month")).toBe(true);
    expect(isRangePreset("last_6_months")).toBe(true);
    expect(isRangePreset("last_year")).toBe(true);
    expect(isRangePreset("custom")).toBe(true);
  });

  it("rechaza valores inválidos", () => {
    expect(isRangePreset("all")).toBe(false);
    expect(isRangePreset("")).toBe(false);
    expect(isRangePreset(null)).toBe(false);
    expect(isRangePreset(undefined)).toBe(false);
    expect(isRangePreset(123)).toBe(false);
  });
});

describe("resolveRange", () => {
  it("current_month: from = 1ro del mes, to = hoy", () => {
    const r = resolveRange("current_month", null);
    expect(r).not.toBeNull();
    const today = todayIsoLocal();
    expect(r!.to).toBe(today);
    expect(r!.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(r!.from.slice(0, 7)).toBe(today.slice(0, 7));
  });

  it("last_6_months: from ≈ 6 meses atrás, to = hoy", () => {
    const r = resolveRange("last_6_months", null);
    expect(r).not.toBeNull();
    expect(r!.to).toBe(todayIsoLocal());
    expect(r!.from < r!.to).toBe(true);
  });

  it("last_year: from ≈ 12 meses atrás, to = hoy", () => {
    const r = resolveRange("last_year", null);
    expect(r).not.toBeNull();
    expect(r!.to).toBe(todayIsoLocal());
    expect(r!.from < r!.to).toBe(true);
  });

  it("custom con range válido devuelve ese range", () => {
    const r = resolveRange("custom", { from: "2026-01-01", to: "2026-03-31" });
    expect(r).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });

  it("custom sin range devuelve null", () => {
    expect(resolveRange("custom", null)).toBeNull();
  });

  it("custom con from o to vacíos devuelve null", () => {
    expect(resolveRange("custom", { from: "", to: "2026-03-31" })).toBeNull();
    expect(resolveRange("custom", { from: "2026-01-01", to: "" })).toBeNull();
  });
});
