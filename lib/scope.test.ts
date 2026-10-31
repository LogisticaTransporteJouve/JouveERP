import { describe, expect, it } from "vitest";

import {
  channelIsFiscal,
  defaultChannelFor,
  FISCAL_FILTERS,
  isFiscalFilter,
  isFiscalFor,
  parseFiscalFilter,
  serializeFiscalFilter,
} from "./scope";

describe("serializeFiscalFilter / parseFiscalFilter", () => {
  it.each(FISCAL_FILTERS)("ida y vuelta de %s", (filter) => {
    expect(parseFiscalFilter(serializeFiscalFilter(filter))).toBe(filter);
  });

  it("toma fiscalFilter del objeto viejo con división", () => {
    expect(
      parseFiscalFilter(
        JSON.stringify({ division: "dz", fiscalFilter: "internal" }),
      ),
    ).toBe("internal");
    expect(parseFiscalFilter(JSON.stringify({ division: "jouve" }))).toBe(
      "all",
    );
  });

  it("acepta un valor pelado", () => {
    expect(parseFiscalFilter("fiscal")).toBe("fiscal");
    expect(parseFiscalFilter('"internal"')).toBe("internal");
  });

  it("con basura o vacío devuelve all", () => {
    expect(parseFiscalFilter(undefined)).toBe("all");
    expect(parseFiscalFilter("")).toBe("all");
    expect(parseFiscalFilter("{nope")).toBe("all");
    expect(parseFiscalFilter(JSON.stringify({ fiscalFilter: "x" }))).toBe(
      "all",
    );
    expect(parseFiscalFilter("null")).toBe("all");
  });
});

describe("channelIsFiscal", () => {
  const channels = [
    { id: "jouve_fiscal", is_fiscal: true, is_active: true },
    { id: "jouve_internal", is_fiscal: false, is_active: true },
    { id: "dz_fiscal", is_fiscal: true, is_active: false },
  ];

  it("clasifica un canal inactivo", () => {
    expect(channelIsFiscal("dz_fiscal", channels)).toBe(true);
  });

  it("clasifica los activos", () => {
    expect(channelIsFiscal("jouve_fiscal", channels)).toBe(true);
    expect(channelIsFiscal("jouve_internal", channels)).toBe(false);
  });

  it("devuelve null con un id desconocido o vacío", () => {
    expect(channelIsFiscal("otro", channels)).toBeNull();
    expect(channelIsFiscal(null, channels)).toBeNull();
    expect(channelIsFiscal("", channels)).toBeNull();
  });
});

describe("isFiscalFor", () => {
  it("todos → null; fiscal → true; interno → false", () => {
    expect(isFiscalFor("all")).toBeNull();
    expect(isFiscalFor("fiscal")).toBe(true);
    expect(isFiscalFor("internal")).toBe(false);
  });
});

describe("defaultChannelFor", () => {
  const channels = [
    { id: "jouve_fiscal", is_fiscal: true, is_active: true },
    { id: "jouve_internal", is_fiscal: false, is_active: true },
    { id: "dz_fiscal", is_fiscal: true, is_active: false },
  ];

  it("elige el único canal activo del alcance", () => {
    expect(defaultChannelFor("fiscal", channels)).toBe("jouve_fiscal");
    expect(defaultChannelFor("internal", channels)).toBe("jouve_internal");
  });

  it("con más de un canal activo no elige", () => {
    expect(defaultChannelFor("all", channels)).toBeNull();
    expect(
      defaultChannelFor("fiscal", [
        ...channels,
        { id: "otro_fiscal", is_fiscal: true, is_active: true },
      ]),
    ).toBeNull();
  });

  it("nunca elige un canal inactivo", () => {
    expect(
      defaultChannelFor("fiscal", [
        { id: "dz_fiscal", is_fiscal: true, is_active: false },
      ]),
    ).toBeNull();
    expect(defaultChannelFor("fiscal", [])).toBeNull();
  });
});

describe("isFiscalFilter", () => {
  it("acepta solo los tres valores", () => {
    expect(FISCAL_FILTERS.every(isFiscalFilter)).toBe(true);
    expect(isFiscalFilter("dz")).toBe(false);
    expect(isFiscalFilter(null)).toBe(false);
  });
});
