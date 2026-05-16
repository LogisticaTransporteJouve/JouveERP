import { describe, expect, it } from "vitest";

import {
  ALLOWED_DOCUMENT_TYPES,
  MAX_FILE_SIZE,
  getFileTypeLabel,
  validateFile,
} from "./file-upload-utils";

function makeFile(type: string, sizeBytes: number, name = "x"): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe("validateFile", () => {
  it("accepts whitelisted PDF under size cap", () => {
    expect(validateFile(makeFile("application/pdf", 1024))).toBeNull();
  });

  it("rejects file type not in whitelist", () => {
    const err = validateFile(makeFile("text/html", 1024));
    expect(err).toMatch(/Tipo no permitido/);
  });

  it("rejects file larger than max size", () => {
    const err = validateFile(makeFile("application/pdf", MAX_FILE_SIZE + 1));
    expect(err).toMatch(/supera/);
  });

  it("accepts each allowed mime type", () => {
    for (const mime of Object.keys(ALLOWED_DOCUMENT_TYPES)) {
      expect(validateFile(makeFile(mime, 1024))).toBeNull();
    }
  });
});

describe("getFileTypeLabel", () => {
  it("returns short labels for known mime types", () => {
    expect(getFileTypeLabel("application/pdf")).toBe("PDF");
    expect(getFileTypeLabel("image/png")).toBe("PNG");
  });

  it("falls back to the subtype in uppercase for unknown mimes", () => {
    expect(getFileTypeLabel("application/zip")).toBe("ZIP");
  });
});
