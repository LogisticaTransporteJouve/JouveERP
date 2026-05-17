import { describe, expect, it } from "vitest";

import {
  channelsForScope,
  isDivision,
  isFiscalFilter,
  type InvoicingChannelSummary,
  type Scope,
} from "./scope";

const ch = (
  id: string,
  division: "dz" | "jouve",
  is_fiscal: boolean,
  is_active = true,
): InvoicingChannelSummary => ({
  id,
  name: `${id}-name`,
  division,
  is_fiscal,
  is_active,
});

const CHANNELS: InvoicingChannelSummary[] = [
  ch("jouve_fiscal", "jouve", true),
  ch("jouve_interno", "jouve", false),
  ch("dz_fiscal", "dz", true),
  ch("dz_interno", "dz", false),
  ch("dz_old", "dz", true, false), // inactive
];

const scope = (
  division: Scope["division"],
  fiscalFilter: Scope["fiscalFilter"],
): Scope => ({ division, fiscalFilter });

describe("channelsForScope", () => {
  it("devuelve null cuando no hay división y filter='all' (no filtra)", () => {
    expect(channelsForScope(scope(null, "all"), CHANNELS)).toBeNull();
  });

  it("filtra por división = jouve", () => {
    const ids = channelsForScope(scope("jouve", "all"), CHANNELS);
    expect(ids).toEqual(["jouve_fiscal", "jouve_interno"]);
  });

  it("filtra por división = dz (excluye inactivos)", () => {
    const ids = channelsForScope(scope("dz", "all"), CHANNELS);
    expect(ids).toEqual(["dz_fiscal", "dz_interno"]);
  });

  it("filtra fiscalFilter='fiscal' cross-divisiones", () => {
    const ids = channelsForScope(scope(null, "fiscal"), CHANNELS);
    expect(ids).toEqual(["jouve_fiscal", "dz_fiscal"]);
  });

  it("filtra fiscalFilter='internal' cross-divisiones", () => {
    const ids = channelsForScope(scope(null, "internal"), CHANNELS);
    expect(ids).toEqual(["jouve_interno", "dz_interno"]);
  });

  it("combina división + fiscalFilter", () => {
    expect(channelsForScope(scope("jouve", "fiscal"), CHANNELS)).toEqual([
      "jouve_fiscal",
    ]);
    expect(channelsForScope(scope("dz", "internal"), CHANNELS)).toEqual([
      "dz_interno",
    ]);
  });

  it("siempre excluye canales inactivos", () => {
    const ids = channelsForScope(scope("dz", "fiscal"), CHANNELS);
    expect(ids).toEqual(["dz_fiscal"]);
    expect(ids).not.toContain("dz_old");
  });

  it("devuelve array vacío si no matchea ningún canal", () => {
    const empty: InvoicingChannelSummary[] = [];
    expect(channelsForScope(scope("jouve", "fiscal"), empty)).toEqual([]);
  });
});

describe("isDivision", () => {
  it("acepta valores válidos", () => {
    expect(isDivision("dz")).toBe(true);
    expect(isDivision("jouve")).toBe(true);
  });

  it("rechaza inválidos", () => {
    expect(isDivision("other")).toBe(false);
    expect(isDivision("")).toBe(false);
    expect(isDivision(null)).toBe(false);
    expect(isDivision(undefined)).toBe(false);
    expect(isDivision(0)).toBe(false);
  });
});

describe("isFiscalFilter", () => {
  it("acepta valores válidos", () => {
    expect(isFiscalFilter("all")).toBe(true);
    expect(isFiscalFilter("fiscal")).toBe(true);
    expect(isFiscalFilter("internal")).toBe(true);
  });

  it("rechaza inválidos", () => {
    expect(isFiscalFilter("none")).toBe(false);
    expect(isFiscalFilter("")).toBe(false);
    expect(isFiscalFilter(null)).toBe(false);
    expect(isFiscalFilter(true)).toBe(false);
  });
});
