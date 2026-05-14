import { describe, expect, it } from "vitest";

import {
  AVATAR_COLORS,
  getAvatarBgClass,
  getDisplayName,
  getInitials,
  isAvatarColor,
  pickDefaultColor,
} from "./avatars";

describe("getInitials", () => {
  it("returns first letter of each name in uppercase", () => {
    expect(getInitials("Tomas", "Dziurdzia")).toBe("TD");
    expect(getInitials("ana", "garcia")).toBe("AG");
  });

  it("returns single letter when only one name is provided", () => {
    expect(getInitials("Tomas")).toBe("T");
    expect(getInitials(null, "Dziurdzia")).toBe("D");
  });

  it("falls back to email initial when names are empty", () => {
    expect(getInitials(null, null, "tomas@jouve.test")).toBe("T");
    expect(getInitials("", "", "foo@bar.com")).toBe("F");
  });

  it("returns '?' when nothing is provided", () => {
    expect(getInitials()).toBe("?");
    expect(getInitials(null, null, null)).toBe("?");
    expect(getInitials("", "", "")).toBe("?");
  });

  it("ignores whitespace", () => {
    expect(getInitials("  Tomas  ", "  D  ")).toBe("TD");
  });
});

describe("isAvatarColor", () => {
  it("accepts valid colors", () => {
    for (const c of AVATAR_COLORS) {
      expect(isAvatarColor(c)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isAvatarColor("red")).toBe(false);
    expect(isAvatarColor("")).toBe(false);
    expect(isAvatarColor(null)).toBe(false);
    expect(isAvatarColor(undefined)).toBe(false);
    expect(isAvatarColor(42)).toBe(false);
  });
});

describe("getAvatarBgClass", () => {
  it("returns a class for each known color", () => {
    for (const c of AVATAR_COLORS) {
      expect(getAvatarBgClass(c)).toMatch(/bg-[a-z]+-\d{3}/);
    }
  });

  it("falls back to gray for invalid input", () => {
    expect(getAvatarBgClass("not-a-color")).toBe(getAvatarBgClass("gray"));
    expect(getAvatarBgClass(null)).toBe(getAvatarBgClass("gray"));
    expect(getAvatarBgClass(undefined)).toBe(getAvatarBgClass("gray"));
  });
});

describe("pickDefaultColor", () => {
  it("returns one of the known colors", () => {
    expect(AVATAR_COLORS).toContain(pickDefaultColor("any-string"));
  });

  it("is deterministic", () => {
    const id = "00000000-0000-0000-0000-000000000001";
    expect(pickDefaultColor(id)).toBe(pickDefaultColor(id));
  });

  it("distributes across all colors over a sample", () => {
    const seen = new Set<string>();
    // Pequeña muestra de UUIDs random: si el hash no rompe, debería
    // tocar al menos 3 de los 5 colores. Asegurar que el helper no se
    // colapsa en un solo color.
    const sample = [
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
      "44444444-4444-4444-4444-444444444444",
      "55555555-5555-5555-5555-555555555555",
      "66666666-6666-6666-6666-666666666666",
      "77777777-7777-7777-7777-777777777777",
      "88888888-8888-8888-8888-888888888888",
      "99999999-9999-9999-9999-999999999999",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    ];
    for (const id of sample) seen.add(pickDefaultColor(id));
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});

describe("getDisplayName", () => {
  it("joins first and last when both exist", () => {
    expect(getDisplayName("Tomas", "Dziurdzia")).toBe("Tomas Dziurdzia");
  });

  it("returns whichever name exists", () => {
    expect(getDisplayName("Tomas", null)).toBe("Tomas");
    expect(getDisplayName(null, "Dziurdzia")).toBe("Dziurdzia");
  });

  it("falls back to email when no name is set", () => {
    expect(getDisplayName(null, null, "tomas@jouve.test")).toBe(
      "tomas@jouve.test",
    );
  });

  it("returns 'Usuario' as last resort", () => {
    expect(getDisplayName()).toBe("Usuario");
    expect(getDisplayName("", "", "")).toBe("Usuario");
  });
});
