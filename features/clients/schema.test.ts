import { describe, expect, it } from "vitest";

import {
  ClientCreateSchema,
  ClientUpdateSchema,
  isIvaCondition,
  IVA_CONDITIONS,
} from "./schema";

const validBase = {
  cuit: "30714637432",
  legal_name: "Cliente SRL",
  iva_condition: "responsable_inscripto" as const,
};

describe("ClientCreateSchema", () => {
  it("accepts a valid client", () => {
    const result = ClientCreateSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("normalises CUIT with dashes and spaces", () => {
    const result = ClientCreateSchema.safeParse({
      ...validBase,
      cuit: "30-71463743-2",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.is_fiscal) {
      expect(result.data.cuit).toBe("30714637432");
    }
  });

  it("rejects CUITs that are not 11 digits", () => {
    expect(
      ClientCreateSchema.safeParse({ ...validBase, cuit: "1234" }).success,
    ).toBe(false);
    expect(
      ClientCreateSchema.safeParse({ ...validBase, cuit: "ABCDEFGHIJK" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown IVA conditions", () => {
    const result = ClientCreateSchema.safeParse({
      ...validBase,
      iva_condition: "made_up",
    });
    expect(result.success).toBe(false);
  });

  it("requires a legal_name of at least 2 characters", () => {
    expect(
      ClientCreateSchema.safeParse({ ...validBase, legal_name: "A" }).success,
    ).toBe(false);
  });

  it("trims and turns blank optional strings into null", () => {
    const result = ClientCreateSchema.safeParse({
      ...validBase,
      display_name: "   ",
      email: "",
      phone: "  ",
      address: "",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.display_name).toBeNull();
      expect(result.data.email).toBeNull();
      expect(result.data.phone).toBeNull();
      if (result.data.is_fiscal) expect(result.data.address).toBeNull();
      expect(result.data.notes).toBeNull();
    }
  });

  it("rejects malformed emails but accepts valid ones", () => {
    expect(
      ClientCreateSchema.safeParse({ ...validBase, email: "not-an-email" })
        .success,
    ).toBe(false);
    const ok = ClientCreateSchema.safeParse({
      ...validBase,
      email: "ar@example.com",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.email).toBe("ar@example.com");
  });
});

describe("ClientUpdateSchema", () => {
  it("requires an id", () => {
    expect(ClientUpdateSchema.safeParse({ legal_name: "X" }).success).toBe(
      false,
    );
  });

  it("allows partial updates with only the id and one field", () => {
    const result = ClientUpdateSchema.safeParse({
      id: "12345678-1234-4234-8234-123456789012",
      legal_name: "Nuevo Nombre SRL",
    });
    expect(result.success).toBe(true);
  });
});

describe("isIvaCondition", () => {
  it("matches every value in IVA_CONDITIONS", () => {
    for (const cond of IVA_CONDITIONS) {
      expect(isIvaCondition(cond)).toBe(true);
    }
  });

  it("rejects unrelated strings and non-strings", () => {
    expect(isIvaCondition("rando")).toBe(false);
    expect(isIvaCondition(null)).toBe(false);
    expect(isIvaCondition(undefined)).toBe(false);
    expect(isIvaCondition(123)).toBe(false);
  });
});

describe("ClientCreateSchema sides", () => {
  it("defaults to a fiscal client when the side is not given", () => {
    const result = ClientCreateSchema.safeParse({
      cuit: "30714637432",
      legal_name: "Cliente SA",
      iva_condition: "responsable_inscripto",
    });
    expect(result.success && result.data.is_fiscal).toBe(true);
  });

  it("accepts an internal client with only a name and drops CUIT and IVA", () => {
    const result = ClientCreateSchema.safeParse({
      is_fiscal: false,
      legal_name: "Juan interno",
      cuit: "",
      iva_condition: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("cuit");
      expect(result.data).not.toHaveProperty("iva_condition");
    }
  });

  it("still requires CUIT and IVA for a fiscal client", () => {
    expect(
      ClientCreateSchema.safeParse({ is_fiscal: true, legal_name: "Sin CUIT" })
        .success,
    ).toBe(false);
  });
});
