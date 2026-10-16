import { describe, expect, it } from "vitest";

import {
  CHAT_ATTACHMENT_MAX_BYTES,
  XLSX_MIME,
  isScannableMime,
  normalizeChatAttachmentMime,
  validateChatAttachment,
} from "./limits";
import { bytesMatchMime } from "./sniff";

describe("normalizeChatAttachmentMime", () => {
  it("fixes the CSV types browsers report", () => {
    expect(normalizeChatAttachmentMime("ventas.csv", "")).toBe("text/csv");
    expect(
      normalizeChatAttachmentMime("ventas.csv", "application/vnd.ms-excel"),
    ).toBe("text/csv");
    expect(normalizeChatAttachmentMime("planilla.xlsx", "")).toBe(XLSX_MIME);
  });

  it("keeps a reported type otherwise", () => {
    expect(normalizeChatAttachmentMime("foto.png", "image/png")).toBe(
      "image/png",
    );
    expect(
      normalizeChatAttachmentMime("viejo.xls", "application/vnd.ms-excel"),
    ).toBe("application/vnd.ms-excel");
  });
});

describe("validateChatAttachment", () => {
  it("accepts PDF, images, CSV and XLSX up to 10 MB", () => {
    const files: [string, string][] = [
      ["a.pdf", "application/pdf"],
      ["a.jpg", "image/jpeg"],
      ["a.webp", "image/webp"],
      ["a.csv", "text/csv"],
      ["a.xlsx", XLSX_MIME],
    ];
    for (const [name, type] of files) {
      expect(validateChatAttachment({ name, type, size: 100 })).toBeNull();
    }
    expect(
      validateChatAttachment({
        name: "a.pdf",
        type: "application/pdf",
        size: CHAT_ATTACHMENT_MAX_BYTES,
      }),
    ).toBeNull();
  });

  it("rejects other types, empty and oversized files", () => {
    expect(
      validateChatAttachment({
        name: "viejo.xls",
        type: "application/vnd.ms-excel",
        size: 10,
      }),
    ).toMatch(/Tipo no permitido/);
    expect(
      validateChatAttachment({
        name: "x.exe",
        type: "application/x-msdownload",
        size: 10,
      }),
    ).toMatch(/Tipo no permitido/);
    expect(
      validateChatAttachment({
        name: "a.pdf",
        type: "application/pdf",
        size: 0,
      }),
    ).toMatch(/vacío/);
    expect(
      validateChatAttachment({
        name: "a.pdf",
        type: "application/pdf",
        size: CHAT_ATTACHMENT_MAX_BYTES + 1,
      }),
    ).toMatch(/4 MB/);
    expect(
      validateChatAttachment({
        name: "foto.png",
        type: "image/png",
        size: 3.8 * 1024 * 1024,
      }),
    ).toMatch(/3,7 MB/);
  });

  it("only PDF and images go to Document Intelligence", () => {
    expect(isScannableMime("application/pdf")).toBe(true);
    expect(isScannableMime("image/webp")).toBe(true);
    expect(isScannableMime("text/csv")).toBe(false);
    expect(isScannableMime(null)).toBe(false);
  });
});

describe("bytesMatchMime", () => {
  const ascii = (s: string) => new TextEncoder().encode(s);

  it("checks the magic bytes of each type", () => {
    expect(bytesMatchMime(ascii("%PDF-1.7\n"), "application/pdf")).toBe(true);
    expect(bytesMatchMime(ascii("\n %PDF-1.4"), "application/pdf")).toBe(true);
    expect(
      bytesMatchMime(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/png",
      ),
    ).toBe(true);
    expect(
      bytesMatchMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"),
    ).toBe(true);
    expect(bytesMatchMime(ascii("RIFF\0\0\0\0WEBPVP8 "), "image/webp")).toBe(
      true,
    );
    expect(bytesMatchMime(ascii("PK\u0003\u0004"), XLSX_MIME)).toBe(true);
    expect(bytesMatchMime(ascii("a;b\n1;2\n"), "text/csv")).toBe(true);
  });

  it("rejects a file that is not what it claims", () => {
    expect(bytesMatchMime(ascii("<html>"), "application/pdf")).toBe(false);
    expect(bytesMatchMime(ascii("%PDF-1.7"), "image/png")).toBe(false);
    expect(bytesMatchMime(Uint8Array.from([0x61, 0, 0x62]), "text/csv")).toBe(
      false,
    );
    expect(bytesMatchMime(ascii("x"), "application/zip")).toBe(false);
  });
});
