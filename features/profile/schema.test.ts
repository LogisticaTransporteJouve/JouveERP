import { describe, expect, it } from "vitest";

import { UpdateProfileSchema } from "./schema";

const validInput = {
  firstName: "Ada",
  lastName: "Lovelace",
  color: "blue" as const,
};

describe("UpdateProfileSchema", () => {
  it("accepts valid input", () => {
    const r = UpdateProfileSchema.safeParse(validInput);
    expect(r.success).toBe(true);
  });

  it("trims and rejects empty firstName", () => {
    const r = UpdateProfileSchema.safeParse({ ...validInput, firstName: "   " });
    expect(r.success).toBe(false);
  });

  it("rejects empty lastName", () => {
    const r = UpdateProfileSchema.safeParse({ ...validInput, lastName: "" });
    expect(r.success).toBe(false);
  });

  it("rejects firstName longer than 80 chars", () => {
    const r = UpdateProfileSchema.safeParse({
      ...validInput,
      firstName: "a".repeat(81),
    });
    expect(r.success).toBe(false);
  });

  it("rejects lastName longer than 80 chars", () => {
    const r = UpdateProfileSchema.safeParse({
      ...validInput,
      lastName: "b".repeat(81),
    });
    expect(r.success).toBe(false);
  });

  it("accepts a name with exactly 80 chars", () => {
    const r = UpdateProfileSchema.safeParse({
      ...validInput,
      firstName: "a".repeat(80),
      lastName: "b".repeat(80),
    });
    expect(r.success).toBe(true);
  });

  it("rejects a color outside the enum", () => {
    const r = UpdateProfileSchema.safeParse({
      ...validInput,
      color: "magenta",
    });
    expect(r.success).toBe(false);
  });

  it("accepts every color in AVATAR_COLORS", () => {
    for (const color of ["gray", "blue", "sage", "orange", "purple"] as const) {
      const r = UpdateProfileSchema.safeParse({ ...validInput, color });
      expect(r.success).toBe(true);
    }
  });
});
