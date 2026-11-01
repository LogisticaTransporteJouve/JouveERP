import { describe, expect, it } from "vitest";

import { formatCuitInput, isValidCuit, normalizeCuit } from "./cuit";

describe("isValidCuit", () => {
  it("accepts valid CUITs (check digit correct)", () => {
    expect(isValidCuit("20123456786")).toBe(true); // 20-12345678-6
    expect(isValidCuit("20-12345678-6")).toBe(true); // with separators
    expect(isValidCuit("30707429433")).toBe(true); // 30-70742943-3
  });

  it("rejects wrong check digit", () => {
    expect(isValidCuit("20123456780")).toBe(false);
    expect(isValidCuit("20123456789")).toBe(false);
  });

  it("rejects wrong length / non-numeric", () => {
    expect(isValidCuit("2012345678")).toBe(false);
    expect(isValidCuit("201234567861")).toBe(false);
    expect(isValidCuit("")).toBe(false);
    expect(isValidCuit("abcdefghijk")).toBe(false);
  });
});

describe("normalizeCuit", () => {
  it("strips separators and validates length", () => {
    expect(normalizeCuit("20-12345678-6")).toBe("20123456786");
    expect(normalizeCuit("2012345678")).toBeNull();
  });
});

describe("formatCuitInput", () => {
  it("adds the dashes as the digits are typed", () => {
    expect(formatCuitInput("")).toBe("");
    expect(formatCuitInput("20")).toBe("20");
    expect(formatCuitInput("201")).toBe("20-1");
    expect(formatCuitInput("2012345678")).toBe("20-12345678");
    expect(formatCuitInput("20123456786")).toBe("20-12345678-6");
  });

  it("drops non-digits and anything past 11 digits", () => {
    expect(formatCuitInput("20-12345678-6")).toBe("20-12345678-6");
    expect(formatCuitInput("2012345678612345")).toBe("20-12345678-6");
    expect(formatCuitInput("20a12")).toBe("20-12");
  });
});
