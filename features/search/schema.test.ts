import { describe, expect, it } from "vitest";

import { ENTITY_LABEL, SearchGlobalInputSchema } from "./schema";

describe("SearchGlobalInputSchema", () => {
  it("acepta una query simple", () => {
    expect(SearchGlobalInputSchema.safeParse({ query: "acme" }).success).toBe(
      true,
    );
  });

  it("recorta espacios en la query", () => {
    const parsed = SearchGlobalInputSchema.safeParse({ query: "  acme  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.query).toBe("acme");
  });

  it("rechaza query de más de 200 chars", () => {
    expect(
      SearchGlobalInputSchema.safeParse({ query: "x".repeat(201) }).success,
    ).toBe(false);
  });

  it("acepta limit dentro de [1, 50]", () => {
    expect(
      SearchGlobalInputSchema.safeParse({ query: "a", limit: 1 }).success,
    ).toBe(true);
    expect(
      SearchGlobalInputSchema.safeParse({ query: "a", limit: 50 }).success,
    ).toBe(true);
  });

  it("rechaza limit fuera de rango o no entero", () => {
    expect(
      SearchGlobalInputSchema.safeParse({ query: "a", limit: 0 }).success,
    ).toBe(false);
    expect(
      SearchGlobalInputSchema.safeParse({ query: "a", limit: 51 }).success,
    ).toBe(false);
    expect(
      SearchGlobalInputSchema.safeParse({ query: "a", limit: 2.5 }).success,
    ).toBe(false);
  });

  it("limit es opcional", () => {
    expect(SearchGlobalInputSchema.safeParse({ query: "a" }).success).toBe(
      true,
    );
  });
});

describe("ENTITY_LABEL", () => {
  it("tiene etiqueta para cada entidad buscable", () => {
    for (const key of [
      "client",
      "supplier",
      "invoice",
      "purchase_invoice",
      "receipt",
      "payment_order",
      "transaction",
    ]) {
      expect(ENTITY_LABEL[key]).toBeTruthy();
    }
  });
});
