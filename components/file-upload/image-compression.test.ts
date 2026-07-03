import { describe, expect, it } from "vitest";

import {
  COMPRESS_THRESHOLD,
  jpegFileName,
  shouldCompressImage,
} from "./image-compression";

function makeFile(type: string, sizeBytes: number, name = "x.jpg"): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe("shouldCompressImage", () => {
  it("skips non-images regardless of size", () => {
    expect(
      shouldCompressImage(makeFile("application/pdf", COMPRESS_THRESHOLD * 4)),
    ).toBe(false);
  });

  it("skips small whitelisted images", () => {
    expect(shouldCompressImage(makeFile("image/jpeg", 200 * 1024))).toBe(false);
    expect(shouldCompressImage(makeFile("image/png", 200 * 1024))).toBe(false);
  });

  it("compresses whitelisted images above the threshold", () => {
    expect(
      shouldCompressImage(makeFile("image/jpeg", COMPRESS_THRESHOLD + 1)),
    ).toBe(true);
  });

  it("always re-encodes non-whitelisted image types (HEIC)", () => {
    expect(shouldCompressImage(makeFile("image/heic", 10 * 1024))).toBe(true);
    expect(shouldCompressImage(makeFile("image/heif", 10 * 1024))).toBe(true);
  });
});

describe("jpegFileName", () => {
  it("swaps the extension", () => {
    expect(jpegFileName("remito.heic")).toBe("remito.jpg");
    expect(jpegFileName("foto.PNG")).toBe("foto.jpg");
  });

  it("appends when there is no extension", () => {
    expect(jpegFileName("remito")).toBe("remito.jpg");
  });

  it("falls back for extension-only names", () => {
    expect(jpegFileName(".heic")).toBe("foto.jpg");
  });
});
