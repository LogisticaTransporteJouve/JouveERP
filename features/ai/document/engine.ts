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

// Invoice schemas exceed Anthropic's 16 union-typed-parameter limit when
// combined, so they're extracted as header + items in two calls.
const INVOICE_KINDS = new Set<ExtractableKind>([
  "factura_compra",
  "factura_venta",
  "nc_nd",
]);

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

const EXTRACT_SYSTEM = `Sos un extractor de datos de documentos contables argentinos. Extraés EXACTAMENTE lo que figura en el documento; si un dato no aparece, devolvés null (no lo inventes ni lo calcules: los faltantes se completan después de forma determinística). Montos como números, sin separadores de miles ni símbolo (1234.56). Fechas en formato AAAA-MM-DD. Para facturas, una fila por ítem visible (salteá subtotales y filas de total).`;

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
  });
  return object;
}

/** Stage 2 — extract structured data with the schema for `kind`. */
export async function extractDocument(
  kind: ExtractableKind,
  doc: DocumentBytes,
): Promise<unknown> {
  const content: ModelMessage["content"] = [
    { type: "text", text: `Extraé los datos de este documento (tipo: ${kind}).` },
    documentPart(doc),
  ];

  // Invoices: extract header and line items separately so neither schema
  // exceeds Anthropic's 16 union-typed-parameter limit, then merge.
  if (INVOICE_KINDS.has(kind)) {
    const [header, lines] = await Promise.all([
      generateObject({
        model: buildExtractionModel(),
        schema: InvoiceHeaderSchema,
        schemaName: "ExtraccionFacturaCabecera",
        system: EXTRACT_SYSTEM,
        maxRetries: 2,
        messages: [{ role: "user", content }],
      }),
      generateObject({
        model: buildExtractionModel(),
        schema: InvoiceItemsSchema,
        schemaName: "ExtraccionFacturaItems",
        system: EXTRACT_SYSTEM,
        maxRetries: 2,
        messages: [{ role: "user", content }],
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
  });
  return object;
}
