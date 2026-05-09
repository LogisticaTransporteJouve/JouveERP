import { describe, expect, it } from "vitest";

import { buildInvoiceQRUrl, type InvoiceQRPayload } from "./qr";

const basePayload: InvoiceQRPayload = {
  fecha: "2026-05-09",
  cuit: "30714637432",
  ptoVta: 3,
  tipoCmp: 6,
  nroCmp: 124,
  importe: 121,
  moneda: "PES",
  ctz: 1,
  tipoDocRec: 80,
  nroDocRec: 30714637432,
  tipoCodAut: "E",
  codAut: "70333333401",
};

function decodeQrPayload(url: string): Record<string, unknown> {
  const param = new URL(url).searchParams.get("p");
  expect(param).toBeTruthy();
  const padded = param!
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(param!.length + ((4 - (param!.length % 4)) % 4), "=");
  const json = Buffer.from(padded, "base64").toString("utf-8");
  return JSON.parse(json) as Record<string, unknown>;
}

describe("buildInvoiceQRUrl", () => {
  it("targets afip.gob.ar/fe/qr/", () => {
    const url = buildInvoiceQRUrl(basePayload);
    expect(url.startsWith("https://www.afip.gob.ar/fe/qr/?p=")).toBe(true);
  });

  it("encodes ver=1 in the canonical payload", () => {
    const decoded = decodeQrPayload(buildInvoiceQRUrl(basePayload));
    expect(decoded.ver).toBe(1);
  });

  it("preserves fecha as YYYY-MM-DD string", () => {
    const decoded = decodeQrPayload(buildInvoiceQRUrl(basePayload));
    expect(decoded.fecha).toBe("2026-05-09");
  });

  it("converts cuit and codAut to numbers (AFIP spec)", () => {
    const decoded = decodeQrPayload(buildInvoiceQRUrl(basePayload));
    expect(typeof decoded.cuit).toBe("number");
    expect(decoded.cuit).toBe(30714637432);
    expect(typeof decoded.codAut).toBe("number");
    expect(decoded.codAut).toBe(70333333401);
  });

  it("keeps moneda and tipoCodAut as strings", () => {
    const decoded = decodeQrPayload(buildInvoiceQRUrl(basePayload));
    expect(decoded.moneda).toBe("PES");
    expect(decoded.tipoCodAut).toBe("E");
  });

  it("uses URL-safe base64 (no +, /, =)", () => {
    // Force a payload that produces a + or / when base64-encoded.
    const payload: InvoiceQRPayload = { ...basePayload, codAut: "99999" };
    const url = buildInvoiceQRUrl(payload);
    const param = new URL(url).searchParams.get("p")!;
    expect(param).not.toMatch(/[+/=]/);
  });

  it("round-trips all canonical fields", () => {
    const decoded = decodeQrPayload(buildInvoiceQRUrl(basePayload));
    expect(decoded).toEqual({
      ver: 1,
      fecha: "2026-05-09",
      cuit: 30714637432,
      ptoVta: 3,
      tipoCmp: 6,
      nroCmp: 124,
      importe: 121,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: 80,
      nroDocRec: 30714637432,
      tipoCodAut: "E",
      codAut: 70333333401,
    });
  });
});
