import { describe, expect, it } from "vitest";

import { buildStorageKey, getSafeExtension } from "./storage-path";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("getSafeExtension", () => {
  it("returns the lowercase extension when ASCII-safe and short", () => {
    expect(getSafeExtension("factura.PDF")).toBe("pdf");
    expect(getSafeExtension("foto.JPEG")).toBe("jpeg");
    expect(getSafeExtension("archivo.csv")).toBe("csv");
  });

  it("returns empty for filenames without a dot", () => {
    expect(getSafeExtension("README")).toBe("");
  });

  it("returns empty for filenames ending in a dot", () => {
    expect(getSafeExtension("file.")).toBe("");
  });

  it("rejects extensions longer than 8 chars", () => {
    expect(getSafeExtension("archive.tarbz222")).toBe("");
  });

  it("rejects non-alphanumeric extensions", () => {
    expect(getSafeExtension("file.exe!")).toBe("");
    expect(getSafeExtension("file.x-y")).toBe("");
  });

  it("only considers the trailing extension", () => {
    expect(getSafeExtension("backup.sql.gz")).toBe("gz");
  });
});

describe("buildStorageKey", () => {
  it("appends safe extension when present", () => {
    expect(buildStorageKey(UUID, "factura.pdf")).toBe(`${UUID}.pdf`);
  });

  it("returns bare uuid when extension is unsafe", () => {
    expect(buildStorageKey(UUID, "weird.exe!")).toBe(UUID);
  });

  it("handles filenames with spaces / unicode by ignoring the name entirely", () => {
    expect(buildStorageKey(UUID, "Mi documentación 🇦🇷.pdf")).toBe(
      `${UUID}.pdf`,
    );
  });

  it("rejects path traversal attempts via filename", () => {
    // Path traversal can only appear in `bucket_path`. Since we discard the
    // filename body entirely, `../etc/passwd` produces a bare uuid.
    expect(buildStorageKey(UUID, "../../etc/passwd")).toBe(UUID);
  });

  it("returns bare uuid for empty filename", () => {
    expect(buildStorageKey(UUID, "")).toBe(UUID);
  });
});
