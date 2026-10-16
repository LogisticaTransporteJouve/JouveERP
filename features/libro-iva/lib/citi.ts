// Libro IVA Digital / Portal IVA — archivos TXT posicionales de importación
// (diseño heredado de RG 3685 "CITI"; ARCA usa los mismos layouts para el
// Registro Electrónico de Operaciones de IVA Simple, RG 5705). Referencia:
// "Diseños de Registros" oficial — VENTAS_CBTE 266 chars / VENTAS_ALICUOTAS 62 /
// COMPRAS_CBTE 325 / COMPRAS_ALICUOTAS 84. Importes: 13 enteros + 2 decimales
// implícitos, cero-padded; fechas AAAAMMDD; tipo de cambio 4 + 6 decimales.

import type {
  LibroIvaComprasGroupedRow,
  LibroIvaVentasGroupedRow,
} from "../schema";

export type CitiFile = {
  name: string;
  content: string;
};

export type CitiExport = {
  files: CitiFile[];
  /** Documents excluded from the export and why — shown to the accountant. */
  warnings: string[];
  documents: number;
};

const CRLF = "\r\n";

/** iva_rate_id (AFIP) → percent, for inferring the rate of header-only rows. */
const RATE_PCT: Record<number, number> = {
  3: 0,
  9: 2.5,
  8: 5,
  4: 10.5,
  5: 21,
  6: 27,
};

// --- Fixed-width field helpers ----------------------------------------------

/** Integer, zero-padded left. */
function num(value: number, len: number): string {
  return String(Math.trunc(Math.abs(value)))
    .padStart(len, "0")
    .slice(-len);
}

/** Amount with 2 implied decimals (13+2). Negatives carry "-" up front. */
function amount(value: number, len = 15): string {
  const cents = Math.round(Math.abs(value) * 100);
  const digits = String(cents);
  if (value < 0) {
    return `-${digits.padStart(len - 1, "0").slice(-(len - 1))}`;
  }
  return digits.padStart(len, "0").slice(-len);
}

/** Exchange rate: 4 integers + 6 implied decimals (PES → 0001000000). */
function exchangeRate(value: number): string {
  const millionths = Math.round(Math.abs(value) * 1_000_000);
  return String(millionths).padStart(10, "0").slice(-10);
}

/** Uppercased ASCII (AFIP files are ANSI; we normalize to the safe subset). */
function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .toUpperCase();
}

/** Alphanumeric, blank-padded right. */
function text(value: string, len: number): string {
  return normalizeText(value).padEnd(len, " ").slice(0, len);
}

/** Identification numbers (CUIT/DNI): digits only, zero-padded LEFT (spec). */
function docDigits(value: string, len: number): string {
  return value.replace(/\D/g, "").padStart(len, "0").slice(-len);
}

/** AAAAMMDD from YYYY-MM-DD. */
function fecha8(iso: string): string {
  return iso.replaceAll("-", "");
}

function monedaCode(moneda: string | null): string {
  return moneda === "DOL" || moneda === "USD" ? "DOL" : "PES";
}

/** Resolves per_rate buckets to AFIP alícuota entries, inferring the rate of
 *  the "no breakdown" bucket (-1) from the iva/neto ratio. Null = underivable. */
function resolveAlicuotas(
  perRate: Record<number, { neto: number; iva: number }>,
): { rateId: number; neto: number; iva: number }[] | null {
  const out: { rateId: number; neto: number; iva: number }[] = [];
  for (const [key, v] of Object.entries(perRate)) {
    const id = Number(key);
    if (v.neto === 0 && v.iva === 0) continue;
    if (id !== -1) {
      out.push({ rateId: id, neto: v.neto, iva: v.iva });
      continue;
    }
    if (v.iva === 0) {
      out.push({ rateId: 3, neto: v.neto, iva: 0 });
      continue;
    }
    if (v.neto <= 0) return null;
    const pct = (v.iva / v.neto) * 100;
    const match = Object.entries(RATE_PCT).find(
      ([, p]) => Math.abs(pct - p) <= 0.5,
    );
    if (!match) return null;
    out.push({ rateId: Number(match[0]), neto: v.neto, iva: v.iva });
  }
  return out;
}

// --- Ventas -------------------------------------------------------------------

export type VentasDocExtra = {
  moneda: string | null;
  cotizacion: number;
};

/**
 * VENTAS_CBTE (266) + VENTAS_ALICUOTAS (62). One cbte line per document; the
 * alícuotas file lists its records in the same document order (spec
 * requirement). Documents that can't be represented are excluded and reported.
 */
export function buildVentasTxt(
  docs: readonly LibroIvaVentasGroupedRow[],
  extras: ReadonlyMap<string, VentasDocExtra>,
  period: string,
): CitiExport {
  const cbteLines: string[] = [];
  const alicLines: string[] = [];
  const warnings: string[] = [];

  for (const doc of docs) {
    const label = `${doc.punto_venta}-${doc.numero} (${doc.fecha})`;
    if (doc.cbte_tipo_afip === null) {
      warnings.push(`Venta ${label}: sin tipo de comprobante AFIP — excluida.`);
      continue;
    }
    const alicuotas = resolveAlicuotas(doc.per_rate);
    if (alicuotas === null || alicuotas.length === 0) {
      warnings.push(
        `Venta ${label}: no se pudo derivar la alícuota — excluida.`,
      );
      continue;
    }
    const extra = extras.get(doc.invoice_id);
    const moneda = monedaCode(extra?.moneda ?? "PES");
    const cotiz = extra?.cotizacion ?? 1;
    const ivaTotal = alicuotas.reduce((s, a) => s + a.iva, 0);
    const codOperacion =
      ivaTotal === 0
        ? Number(doc.imp_op_ex) > 0
          ? "E"
          : Number(doc.imp_tot_conc) > 0
            ? "N"
            : "0"
        : "0";

    cbteLines.push(
      fecha8(doc.fecha) +
        num(doc.cbte_tipo_afip, 3) +
        num(doc.punto_venta, 5) +
        num(doc.numero, 20) +
        num(doc.numero, 20) +
        num(doc.doc_tipo, 2) +
        docDigits(doc.doc_nro, 20) +
        text(doc.client_legal_name, 30) +
        amount(Number(doc.imp_total)) +
        amount(Number(doc.imp_tot_conc)) +
        amount(0) +
        amount(Number(doc.imp_op_ex)) +
        amount(0) +
        amount(0) +
        amount(0) +
        amount(0) +
        text(moneda, 3) +
        exchangeRate(cotiz) +
        num(alicuotas.length, 1) +
        codOperacion +
        amount(Number(doc.imp_trib)) +
        "00000000",
    );

    for (const a of alicuotas) {
      alicLines.push(
        num(doc.cbte_tipo_afip, 3) +
          num(doc.punto_venta, 5) +
          num(doc.numero, 20) +
          amount(a.neto) +
          num(a.rateId, 4) +
          amount(a.iva),
      );
    }
  }

  const suffix = period.replace("-", "");
  return {
    files: [
      {
        name: `LIBRO_IVA_DIGITAL_VENTAS_CBTE_${suffix}.txt`,
        content: cbteLines.join(CRLF) + (cbteLines.length ? CRLF : ""),
      },
      {
        name: `LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS_${suffix}.txt`,
        content: alicLines.join(CRLF) + (alicLines.length ? CRLF : ""),
      },
    ],
    warnings,
    documents: cbteLines.length,
  };
}

// --- Compras ------------------------------------------------------------------

export type ComprasDocExtra = {
  moneda: string | null;
  cotizacion: number;
};

/** kind + letter → AFIP purchase voucher code (mirror of lib/afip/codes). */
const COMPRAS_CBTE_TIPO: Record<string, Record<string, number>> = {
  factura: { A: 1, B: 6, C: 11 },
  nd: { A: 2, B: 7, C: 12 },
  nc: { A: 3, B: 8, C: 13 },
};

/**
 * COMPRAS_CBTE (325) + COMPRAS_ALICUOTAS (84). Received B/C vouchers carry no
 * discriminated IVA: cantidad de alícuotas 0 and no alícuota record (spec).
 */
export function buildComprasTxt(
  docs: readonly LibroIvaComprasGroupedRow[],
  extras: ReadonlyMap<string, ComprasDocExtra>,
  period: string,
): CitiExport {
  const cbteLines: string[] = [];
  const alicLines: string[] = [];
  const warnings: string[] = [];

  for (const doc of docs) {
    const label = `${doc.punto_venta}-${doc.numero} ${doc.supplier_legal_name} (${doc.fecha})`;
    const cbteTipo = COMPRAS_CBTE_TIPO[doc.kind]?.[doc.letter ?? ""];
    if (!cbteTipo) {
      warnings.push(`Compra ${label}: sin letra A/B/C — excluida.`);
      continue;
    }
    if (!doc.supplier_cuit) {
      warnings.push(`Compra ${label}: proveedor sin CUIT — excluida.`);
      continue;
    }

    const discriminated = doc.letter === "A";
    let alicuotas: { rateId: number; neto: number; iva: number }[] = [];
    if (discriminated) {
      const resolved = resolveAlicuotas(doc.per_rate);
      if (resolved === null || resolved.length === 0) {
        warnings.push(
          `Compra ${label}: no se pudo derivar la alícuota — excluida.`,
        );
        continue;
      }
      alicuotas = resolved;
    }
    const ivaComputable = alicuotas.reduce((s, a) => s + a.iva, 0);
    const extra = extras.get(doc.purchase_invoice_id);
    const moneda = monedaCode(extra?.moneda ?? "PES");
    const cotiz = extra?.cotizacion ?? 1;

    cbteLines.push(
      fecha8(doc.fecha) +
        num(cbteTipo, 3) +
        num(doc.punto_venta, 5) +
        num(doc.numero, 20) +
        "0000000000000000" +
        "80" +
        docDigits(doc.supplier_cuit, 20) +
        text(doc.supplier_legal_name, 30) +
        amount(doc.imp_total) +
        amount(0) +
        amount(0) +
        amount(0) +
        amount(0) +
        amount(0) +
        amount(0) +
        amount(0) +
        text(moneda, 3) +
        exchangeRate(cotiz) +
        num(alicuotas.length, 1) +
        "0" +
        amount(ivaComputable) +
        amount(doc.imp_trib) +
        num(0, 11) +
        text("", 30) +
        amount(0),
    );

    for (const a of alicuotas) {
      alicLines.push(
        num(cbteTipo, 3) +
          num(doc.punto_venta, 5) +
          num(doc.numero, 20) +
          "80" +
          docDigits(doc.supplier_cuit, 20) +
          amount(a.neto) +
          num(a.rateId, 4) +
          amount(a.iva),
      );
    }
  }

  const suffix = period.replace("-", "");
  return {
    files: [
      {
        name: `LIBRO_IVA_DIGITAL_COMPRAS_CBTE_${suffix}.txt`,
        content: cbteLines.join(CRLF) + (cbteLines.length ? CRLF : ""),
      },
      {
        name: `LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS_${suffix}.txt`,
        content: alicLines.join(CRLF) + (alicLines.length ? CRLF : ""),
      },
    ],
    warnings,
    documents: cbteLines.length,
  };
}
