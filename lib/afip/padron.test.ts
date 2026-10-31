import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAddress,
  buildLegalName,
  buildMainActivity,
  mapTaxCondition,
  normalizePersona,
  padronFaultMessage,
  type RawPersona,
} from "./padron";

describe("mapTaxCondition", () => {
  it("returns responsable_inscripto when VAT (id 30) is active", () => {
    expect(
      mapTaxCondition([
        { idImpuesto: 30, estado: "ACTIVO" },
        { idImpuesto: 20, estado: "ACTIVO" },
      ]),
    ).toBe("responsable_inscripto");
  });

  it("ignores VAT registrations that are not ACTIVO", () => {
    expect(
      mapTaxCondition([
        { idImpuesto: 30, estado: "BAJA DEFINITIVA" },
        { idImpuesto: 20, estado: "ACTIVO" },
      ]),
    ).toBe("monotributo");
  });

  it("returns monotributo when only monotax is active", () => {
    expect(mapTaxCondition([{ idImpuesto: 21, estado: "ACTIVO" }])).toBe(
      "monotributo",
    );
  });

  it("returns exento when only exempt registration is active", () => {
    expect(mapTaxCondition([{ idImpuesto: 4, estado: "ACTIVO" }])).toBe(
      "exento",
    );
  });

  it("falls back to no_categorizado when no relevant tax is active", () => {
    expect(mapTaxCondition([])).toBe("no_categorizado");
    expect(mapTaxCondition([{ idImpuesto: 99, estado: "ACTIVO" }])).toBe(
      "no_categorizado",
    );
  });
});

describe("buildLegalName", () => {
  it("uses razonSocial when present (juridica)", () => {
    expect(buildLegalName({ razonSocial: "Cliente SRL" })).toBe("Cliente SRL");
  });

  it("falls back to apellido + nombre when razonSocial is missing", () => {
    expect(buildLegalName({ apellido: "Pérez", nombre: "Juan" })).toBe(
      "Pérez, Juan",
    );
  });

  it("handles missing nombre or apellido without leading commas", () => {
    expect(buildLegalName({ apellido: "Pérez" })).toBe("Pérez");
    expect(buildLegalName({ nombre: "Juan" })).toBe("Juan");
  });
});

describe("buildAddress", () => {
  it("returns null when no addresses", () => {
    expect(buildAddress([])).toBeNull();
  });

  it("prefers FISCAL when present", () => {
    const addr = buildAddress([
      { tipoDomicilio: "LEGAL", direccion: "Calle Otra 1" },
      {
        tipoDomicilio: "FISCAL",
        direccion: "Av Siempre Viva 742",
        localidad: "Springfield",
        descripcionProvincia: "Buenos Aires",
        codPostal: "1900",
      },
    ]);
    expect(addr).toEqual({
      street: "Av Siempre Viva 742",
      city: "Springfield",
      province: "Buenos Aires",
      postal_code: "1900",
    });
  });

  it("falls back to first address when no FISCAL is found", () => {
    const addr = buildAddress([
      { tipoDomicilio: "LEGAL", direccion: "Calle Otra 1" },
    ]);
    expect(addr?.street).toBe("Calle Otra 1");
  });
});

describe("buildMainActivity", () => {
  it("prefers orden=1", () => {
    expect(
      buildMainActivity([
        { orden: 2, descripcionActividad: "secondary" },
        { orden: 1, descripcionActividad: "primary" },
      ]),
    ).toBe("primary");
  });

  it("falls back to lowest orden when no 1 is present", () => {
    expect(
      buildMainActivity([
        { orden: 3, descripcionActividad: "third" },
        { orden: 2, descripcionActividad: "second" },
      ]),
    ).toBe("second");
  });

  it("returns null on empty list", () => {
    expect(buildMainActivity([])).toBeNull();
  });
});

describe("normalizePersona", () => {
  it("flattens single-object impuesto/domicilio/actividad to arrays", () => {
    const persona: RawPersona = {
      tipoPersona: "JURIDICA",
      tipoClave: "CUIT",
      estadoClave: "ACTIVO",
      razonSocial: "Cliente SRL",
      impuesto: { idImpuesto: 30, estado: "ACTIVO" },
      domicilio: { tipoDomicilio: "FISCAL", direccion: "Calle 1" },
      actividad: { orden: 1, descripcionActividad: "Software" },
    };
    const norm = normalizePersona(persona);
    expect(norm.tax_condition).toBe("responsable_inscripto");
    expect(norm.legal_name).toBe("Cliente SRL");
    expect(norm.main_activity).toBe("Software");
    expect(norm.fiscal_address?.street).toBe("Calle 1");
    expect(norm.taxes).toHaveLength(1);
  });

  it("handles missing optional fields gracefully", () => {
    const norm = normalizePersona({});
    expect(norm.person_type).toBe("JURIDICA");
    expect(norm.id_type).toBe("CUIT");
    expect(norm.status).toBe("UNKNOWN");
    expect(norm.tax_condition).toBe("no_categorizado");
    expect(norm.fiscal_address).toBeNull();
  });
});

describe("padronFaultMessage", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("explains a missing CUIT, noting homologación's test-only padrón", () => {
    vi.stubEnv("AFIP_ENV", "homo");
    expect(
      padronFaultMessage("30718543866", "No existe persona con ese Id"),
    ).toMatch(/no está en el padrón de homologación/);
    vi.stubEnv("AFIP_ENV", "prod");
    expect(
      padronFaultMessage("30718543866", "No existe persona con ese Id"),
    ).toBe("El CUIT 30718543866 no existe en el padrón de AFIP.");
  });

  it("passes through other faults without the SOAP envelope", () => {
    expect(padronFaultMessage("30718543866", "Servicio no disponible")).toBe(
      "El padrón de AFIP devolvió un error: Servicio no disponible.",
    );
  });
});
