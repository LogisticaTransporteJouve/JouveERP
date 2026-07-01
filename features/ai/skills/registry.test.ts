import { describe, expect, it } from "vitest";

import { buildSkillsBlock, selectSkills } from "./registry";

describe("selectSkills", () => {
  it("matches a skill by keyword in the message", () => {
    const s = selectSkills("¿cuánto IVA crédito fiscal tengo en compras?");
    expect(s.map((x) => x.id)).toContain("libro-iva");
  });

  it("returns nothing for an unrelated message", () => {
    expect(selectSkills("hola, buen día")).toHaveLength(0);
  });

  it("respects the char budget", () => {
    const s = selectSkills("iva conciliación aging factura A centro de costo", {
      maxChars: 10,
    });
    // budget too small to fit any skill content
    expect(s).toHaveLength(0);
  });
});

describe("buildSkillsBlock", () => {
  it("renders the matched skill title, empty when none", () => {
    expect(buildSkillsBlock("conciliación bancaria del extracto")).toContain(
      "Bank reconciliation",
    );
    expect(buildSkillsBlock("gracias")).toBe("");
  });
});
