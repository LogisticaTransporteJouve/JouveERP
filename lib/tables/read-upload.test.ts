import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { decodeText, readUploadedTable } = await import("./read-upload");

const limits = { rows: 10, columns: 10, cellChars: 100 };

describe("decodeText", () => {
  it("reads UTF-8", () => {
    expect(decodeText(new TextEncoder().encode("Emisión"))).toBe("Emisión");
  });

  it("falls back to windows-1252 for latin1 bytes", () => {
    // "Emisión" in windows-1252: ó is 0xF3, invalid on its own in UTF-8.
    const bytes = new Uint8Array([0x45, 0x6d, 0x69, 0x73, 0x69, 0xf3, 0x6e]);
    expect(decodeText(bytes)).toBe("Emisión");
  });
});

describe("readUploadedTable", () => {
  it("uses the decoder it is given for a CSV", () => {
    const bytes = new Uint8Array([0x61, 0x3b, 0xf3, 0x0a, 0x31, 0x3b, 0x32]);
    const table = readUploadedTable("x.csv", bytes, limits, {
      decode: decodeText,
    });
    expect(table).toEqual({
      rows: [
        ["a", "ó"],
        ["1", "2"],
      ],
      truncated: false,
    });
  });
});
