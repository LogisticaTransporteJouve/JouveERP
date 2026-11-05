import { describe, expect, it } from "vitest";

import {
  ConfigurePosSchema,
  posChannelOptions,
  type PosChannel,
} from "./schema";

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

describe("posChannelOptions", () => {
  const channels: PosChannel[] = [
    {
      id: "jouve_fiscal",
      name: "Logística Jouve",
      is_fiscal: true,
      is_active: true,
    },
    {
      id: "jouve_internal",
      name: "Logística Jouve — Interno",
      is_fiscal: false,
      is_active: true,
    },
    {
      id: "dz_fiscal",
      name: "DZ Instalaciones",
      is_fiscal: true,
      is_active: false,
    },
  ];
  const ids = (point: {
    channel_id: string | null;
    last_synced_at: string | null;
  }) => posChannelOptions(point, channels).map((c) => c.id);

  it("a POS synced with AFIP lists the active fiscal channels", () => {
    expect(
      ids({ channel_id: null, last_synced_at: "2026-11-01T00:00:00Z" }),
    ).toEqual(["jouve_fiscal"]);
  });

  it("the local internal POS lists its own channel", () => {
    expect(ids({ channel_id: "jouve_internal", last_synced_at: null })).toEqual(
      ["jouve_internal"],
    );
  });

  it("keeps the current channel even when inactive", () => {
    expect(
      ids({ channel_id: "dz_fiscal", last_synced_at: "2026-11-01T00:00:00Z" }),
    ).toEqual(["jouve_fiscal", "dz_fiscal"]);
  });
});
