import "server-only";

import QRCode from "qrcode";

// AFIP canonical QR for fiscal comprobantes.
//
// Spec: https://www.afip.gob.ar/fe/qr/especificaciones.asp
//
// The URL is `https://www.afip.gob.ar/fe/qr/?p=<base64>` where <base64> is
// the URL-safe base64 of a JSON document with the canonical fields below.
// AFIP's reader app validates the encoded data against the live comprobante
// — fields must match exactly (numbers as numbers, fechas as YYYY-MM-DD).

const QR_BASE_URL = "https://www.afip.gob.ar/fe/qr/";

// Spec ver=1 (only one in production today).
const VER = 1;

// `tipoCodAut`: 'E' for CAE (electronic), 'A' for CAEA (offline).
export type AuthCodeType = "E" | "A";

export interface InvoiceQRPayload {
  /** Issue date `YYYY-MM-DD`. */
  fecha: string;
  /** Issuer's CUIT (11 digits). */
  cuit: string;
  /** Point of sale. */
  ptoVta: number;
  /** AFIP numeric CbteTipo (1 Factura A, 6 Factura B, etc). */
  tipoCmp: number;
  /** Comprobante number. */
  nroCmp: number;
  /** Total amount with 2 decimals. */
  importe: number;
  /** Currency code (PES, DOL, ...). */
  moneda: string;
  /** Exchange rate in pesos (1 for PES). */
  ctz: number;
  /** Receiver's doc type (80 CUIT, 96 DNI, 99 CF). */
  tipoDocRec: number;
  /** Receiver's doc number (0 for CF). */
  nroDocRec: number;
  /** Authorization code type: 'E' CAE, 'A' CAEA. */
  tipoCodAut: AuthCodeType;
  /** The CAE/CAEA itself. */
  codAut: string;
}

interface CanonicalPayload {
  ver: number;
  fecha: string;
  cuit: number;
  ptoVta: number;
  tipoCmp: number;
  nroCmp: number;
  importe: number;
  moneda: string;
  ctz: number;
  tipoDocRec: number;
  nroDocRec: number;
  tipoCodAut: AuthCodeType;
  codAut: number;
}

function toUrlSafeBase64(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildInvoiceQRUrl(payload: InvoiceQRPayload): string {
  const canonical: CanonicalPayload = {
    ver: VER,
    fecha: payload.fecha,
    cuit: Number(payload.cuit),
    ptoVta: payload.ptoVta,
    tipoCmp: payload.tipoCmp,
    nroCmp: payload.nroCmp,
    importe: payload.importe,
    moneda: payload.moneda,
    ctz: payload.ctz,
    tipoDocRec: payload.tipoDocRec,
    nroDocRec: payload.nroDocRec,
    tipoCodAut: payload.tipoCodAut,
    codAut: Number(payload.codAut),
  };
  const json = JSON.stringify(canonical);
  return `${QR_BASE_URL}?p=${toUrlSafeBase64(json)}`;
}

export async function renderInvoiceQR(
  payload: InvoiceQRPayload,
): Promise<string> {
  const url = buildInvoiceQRUrl(payload);
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
  });
}
