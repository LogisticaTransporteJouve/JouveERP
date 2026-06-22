import { describe, expect, it } from "vitest";

import { ConfigurePosSchema } from "./schema";

const base = {
  numero: 3,
  channel_id: "dz_fiscal",
  nickname: "DZ Fiscal",
  is_enabled: true,
};

describe("ConfigurePosSchema", () => {
  it("acepta un POS válido", () => {
    expect(ConfigurePosSchema.safeParse(base).success).toBe(true);
  });

  it("acepta channel_id y nickname nulos (POS sin configurar)", () => {
    expect(
      ConfigurePosSchema.safeParse({
        ...base,
        channel_id: null,
        nickname: null,
        is_enabled: false,
      }).success,
    ).toBe(true);
  });

  it("rechaza numero fuera de rango [1, 99999]", () => {
    expect(ConfigurePosSchema.safeParse({ ...base, numero: 0 }).success).toBe(
      false,
    );
    expect(
      ConfigurePosSchema.safeParse({ ...base, numero: 100000 }).success,
    ).toBe(false);
  });

  it("acepta los extremos del rango", () => {
    expect(ConfigurePosSchema.safeParse({ ...base, numero: 1 }).success).toBe(
      true,
    );
    expect(
      ConfigurePosSchema.safeParse({ ...base, numero: 99999 }).success,
    ).toBe(true);
  });

  it("rechaza numero no entero", () => {
    expect(ConfigurePosSchema.safeParse({ ...base, numero: 3.5 }).success).toBe(
      false,
    );
  });

  it("rechaza channel_id vacío (debe ser null o tener contenido)", () => {
    expect(
      ConfigurePosSchema.safeParse({ ...base, channel_id: "" }).success,
    ).toBe(false);
  });

  it("rechaza nickname de más de 120 chars", () => {
    expect(
      ConfigurePosSchema.safeParse({ ...base, nickname: "x".repeat(121) })
        .success,
    ).toBe(false);
  });
});
