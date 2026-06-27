import "server-only";

import { generateObject, type ModelMessage } from "ai";

import { buildClassifierModel, buildExtractionModel } from "../model";
import {
  ClassificationSchema,
  EXTRACTION_SCHEMAS,
  InvoiceHeaderSchema,
  InvoiceItemsSchema,
  type Classification,
  type ExtractableKind,
} from "./schemas";

// Invoice-style kinds are extracted as header + items in two focused calls.
const INVOICE_KINDS = new Set<ExtractableKind>([
  "factura_compra",
  "factura_venta",
  "nc_nd",
]);

// Force the json-tool path instead of Anthropic's constrained-decoding
// structured outputs. Extraction schemas have many optional/nullable fields,
// which make the grammar compilation blow up ("too many parameters with union
// types" / "grammar compilation timed out"). A plain json tool is sent instead
// (no grammar) and the result is still validated by Zod.
const ANTHROPIC_OBJECT_OPTIONS = {
  anthropic: { structuredOutputMode: "jsonTool" },
};

// Per-kind focus line appended to the extraction prompt (Sumary's document_focus
// idea), so the model knows what matters for each document type.
const KIND_HINT: Record<ExtractableKind, string> = {
  factura_compra:
    "Es una factura de compra: DZ & Sons es el comprador; la contraparte es el proveedor/vendedor.",
  factura_venta:
    "Es una factura de venta: DZ & Sons es el vendedor; la contraparte es el cliente/comprador.",
  nc_nd: "Es una nota de crédito o débito: tratala como una factura (cabecera + ítems).",
  recibo: "Es un recibo: extraé contraparte, número, fecha e importe total.",
  orden_pago:
    "Es una orden de pago: extraé contraparte, número, fecha e importe total.",
  remito:
    "Es un remito: extraé productos y cantidades por renglón, SIN importes (los remitos no llevan precios).",
  cheque:
    "Es un cheque: banco, número, importe, beneficiario, fecha, tipo (propio/tercero/diferido) y fecha de pago si es diferido.",
  extracto:
    "Es un extracto bancario: una fila por movimiento (fecha, concepto, débito, crédito, saldo) más saldo inicial y final.",
};

export type DocumentBytes = { bytes: Uint8Array; mediaType: string };

/** Build the model content part for a document (image vs PDF/other). */
function documentPart(doc: DocumentBytes) {
  if (doc.mediaType.startsWith("image/")) {
    return {
      type: "image" as const,
      image: doc.bytes,
      mediaType: doc.mediaType,
    };
  }
  return {
    type: "file" as const,
    data: doc.bytes,
    mediaType: doc.mediaType || "application/pdf",
  };
}

const CLASSIFY_SYSTEM = `Sos un clasificador de documentos contables/comerciales argentinos. Mirás el documento y decidís qué es, sin inventar. Devolvés el tipo, una confianza 0..1 y, si la ves, la moneda. Tipos posibles: factura de compra, factura de venta, recibo, orden de pago, remito, cheque, extracto bancario, nota de crédito/débito, u otro.`;

const EXTRACT_SYSTEM = `Sos un extractor de datos de documentos contables argentinos. COPIÁS EXACTAMENTE lo que figura en el documento; si un dato no aparece, devolvés null (no lo inventes ni lo calcules: los faltantes se completan después de forma determinística). Montos como números, sin separadores de miles ni símbolo (1234.56). Fechas en formato AAAA-MM-DD.
Reglas de renglones (facturas/remitos): una fila por renglón visible; no agrupes ni fusiones; salteá filas de subtotal/total y filas que sean solo una etiqueta de IVA.
Reglas de importes: si la columna dice "con IVA" usá importe_total; si dice "sin IVA" usá importe_neto; ante ambigüedad contrastá contra los totales. En tickets y recibos los precios suelen ser con IVA.
Contraparte: DZ & Sons S.A. es la empresa propia; la contraparte (contraparte_nombre/contraparte_cuit) es SIEMPRE la otra parte.`;

/** Stage 1 — classify an unknown document (generic-tray mode). */
export async function classifyDocument(
  doc: DocumentBytes,
  contextHint?: string,
): Promise<Classification> {
  const content: ModelMessage["content"] = [
    {
      type: "text",
      text: `Clasificá este documento.${contextHint ? ` Contexto: ${contextHint}.` : ""}`,
    },
    documentPart(doc),
  ];
  const { object } = await generateObject({
    model: buildClassifierModel(),
    schema: ClassificationSchema,
    schemaName: "ClasificacionDocumento",
    system: CLASSIFY_SYSTEM,
    maxRetries: 2,
    messages: [{ role: "user", content }],
    providerOptions: ANTHROPIC_OBJECT_OPTIONS,
  });
  return object;
}

/** Stage 2 — extract structured data with the schema for `kind`. */
export async function extractDocument(
  kind: ExtractableKind,
  doc: DocumentBytes,
): Promise<unknown> {
  const content: ModelMessage["content"] = [
    {
      type: "text",
      text: `Extraé los datos de este documento (tipo: ${kind}). ${KIND_HINT[kind] ?? ""}`.trim(),
    },
    documentPart(doc),
  ];

  // Invoices: extract header and line items separately so each call stays focused.
  if (INVOICE_KINDS.has(kind)) {
    const [header, lines] = await Promise.all([
      generateObject({
        model: buildExtractionModel(),
        schema: InvoiceHeaderSchema,
        schemaName: "ExtraccionFacturaCabecera",
        system: EXTRACT_SYSTEM,
        maxRetries: 2,
        messages: [{ role: "user", content }],
        providerOptions: ANTHROPIC_OBJECT_OPTIONS,
      }),
      generateObject({
        model: buildExtractionModel(),
        schema: InvoiceItemsSchema,
        schemaName: "ExtraccionFacturaItems",
        system: EXTRACT_SYSTEM,
        maxRetries: 2,
        messages: [{ role: "user", content }],
        providerOptions: ANTHROPIC_OBJECT_OPTIONS,
      }),
    ]);
    return { ...header.object, items: lines.object.items };
  }

  const { object } = await generateObject({
    model: buildExtractionModel(),
    schema: EXTRACTION_SCHEMAS[kind],
    schemaName: "ExtraccionDocumento",
    system: EXTRACT_SYSTEM,
    maxRetries: 2,
    messages: [{ role: "user", content }],
    providerOptions: ANTHROPIC_OBJECT_OPTIONS,
  });
  return object;
}
