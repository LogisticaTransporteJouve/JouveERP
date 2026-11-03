import { describe, expect, it } from "vitest";

import {
  findHeaderRowIndex,
  normalizeHeader,
  parseSheetDate,
  suggestColumnMapping,
} from "./columns";

describe("normalizeHeader", () => {
  it("drops accents, case and punctuation", () => {
    expect(normalizeHeader("  Estación de Servicio ")).toBe(
      "estacion de servicio",
    );
    expect(normalizeHeader("Nro. Tarjeta")).toBe("nro tarjeta");
  });
});

describe("suggestColumnMapping / findHeaderRowIndex", () => {
  const fields = ["name", "cuit"] as const;
  const aliases = { name: ["razon social", "nombre"], cuit: ["cuit"] };

  it("maps exact aliases before prefixes, each column once", () => {
    expect(
      suggestColumnMapping(
        ["Nombre fantasía", "CUIT", "Razón social"],
        fields,
        aliases,
      ),
    ).toEqual({ name: 2, cuit: 1 });
  });

  it("finds the header row under a title", () => {
    expect(
      findHeaderRowIndex(
        [["Listado"], ["Razón social", "CUIT"]],
        fields,
        aliases,
      ),
    ).toBe(1);
    expect(findHeaderRowIndex([["a", "b"]], fields, aliases)).toBe(-1);
  });
});

describe("parseSheetDate", () => {
  it("reads Argentine and ISO dates, with or without a time", () => {
    expect(parseSheetDate("31/10/2026")).toBe("2026-10-31");
    expect(parseSheetDate("1-2-26 14:05")).toBe("2026-02-01");
    expect(parseSheetDate("2026-10-31T08:00:00")).toBe("2026-10-31");
    expect(parseSheetDate("2026-10-31")).toBe("2026-10-31");
  });

  it("rejects impossible or unknown dates", () => {
    expect(parseSheetDate("31/02/2026")).toBeNull();
    expect(parseSheetDate("Total")).toBeNull();
    expect(parseSheetDate("")).toBeNull();
  });
});
