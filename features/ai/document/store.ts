import "server-only";

import type { Json } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import {
  reconcileExtracto,
  type ReconciliationSummary,
} from "@/features/ai/reconciliation/gather";

import type { ExpenseClassifyResult } from "./classify-expense";
import type { DocumentBytes } from "./engine";
import type { ExtractionStatus } from "./types";

/** Serialize a value to a jsonb-safe payload. */
function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value));
}

/** Downloads a stored file's raw bytes (service role) for the vision call. */
export async function downloadFileBytes(
  fileId: string,
): Promise<DocumentBytes & { filename: string }> {
  const service = getServiceClient();
  const { data: file, error } = await service
    .from("files")
    .select("bucket, bucket_path, mime_type, original_filename")
    .eq("id", fileId)
    .maybeSingle();
  if (error) throw error;
  if (!file) throw new Error(`Archivo ${fileId} no existe.`);

  const { data: blob, error: dlError } = await service.storage
    .from(file.bucket)
    .download(file.bucket_path);
  if (dlError || !blob) throw dlError ?? new Error("No se pudo descargar.");

  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    bytes,
    mediaType: file.mime_type ?? "application/pdf",
    filename: file.original_filename,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** CUIT formats to try when matching: raw, digits-only, and XX-XXXXXXXX-X. */
function cuitCandidates(raw: string): string[] {
  const digits = raw.replace(/\D/g, "");
  const set = new Set<string>([raw.trim(), digits]);
  if (digits.length === 11) {
    set.add(`${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`);
  }
  return [...set].filter(Boolean);
}

export type ExtractionMatches = {
  supplier_id?: string;
  supplier_name?: string;
  client_id?: string;
  client_name?: string;
  duplicate_of?: string;
  /** Expense classification suggestion (factura_compra). Human-confirmed. */
  expense?: ExpenseClassifyResult;
  /** Bank-statement reconciliation summary (extracto). */
  reconciliation?: ReconciliationSummary;
};

/**
 * Best-effort match of the extracted counterparty (by CUIT) to an existing
 * supplier/client, plus a duplicate check on (numero, punto_venta) for invoices.
 * Never throws — matching is advisory for the review screen.
 */
export async function matchDocument(input: {
  table: "suppliers" | "clients";
  cuit?: string | null;
  numero?: number | null;
  puntoVenta?: number | null;
  invoiceTable?: "purchase_invoices" | "invoices" | null;
}): Promise<ExtractionMatches> {
  const service = getServiceClient();
  const matches: ExtractionMatches = {};

  try {
    let matchedSupplierId: string | null = null;
    if (input.cuit) {
      const { data } = await service
        .from(input.table)
        .select("id, legal_name, cuit")
        .in("cuit", cuitCandidates(input.cuit))
        .limit(1);
      const row = data?.[0];
      if (row) {
        if (input.table === "suppliers") {
          matches.supplier_id = row.id;
          matches.supplier_name = row.legal_name;
          matchedSupplierId = row.id;
        } else {
          matches.client_id = row.id;
          matches.client_name = row.legal_name;
        }
      }
    }

    if (input.invoiceTable && input.numero != null && input.puntoVenta != null) {
      // A purchase-invoice number is the SUPPLIER's — (numero, punto_venta) is
      // only unique per supplier, so dedupe needs the matched supplier (skip if
      // we couldn't match one). Our own sales invoices are unique by
      // (numero, punto_venta) since each punto_venta maps to one channel.
      if (input.invoiceTable === "purchase_invoices") {
        if (matchedSupplierId) {
          const { data } = await service
            .from("purchase_invoices")
            .select("id")
            .eq("supplier_id", matchedSupplierId)
            .eq("numero", input.numero)
            .eq("punto_venta", input.puntoVenta)
            .limit(1);
          if (data?.[0]) matches.duplicate_of = data[0].id;
        }
      } else {
        const { data } = await service
          .from("invoices")
          .select("id")
          .eq("numero", input.numero)
          .eq("punto_venta", input.puntoVenta)
          .limit(1);
        if (data?.[0]) matches.duplicate_of = data[0].id;
      }
    }
  } catch (err) {
    logger.error("ai.document.match.failed", { error: err });
  }

  return matches;
}

/** Maps a detected kind + extracted payload to a counterparty/duplicate match. */
export async function matchForKind(
  kind: string,
  payload: unknown,
): Promise<ExtractionMatches> {
  if (!isRecord(payload)) return {};
  const cuit =
    typeof payload.counterparty_cuit === "string"
      ? payload.counterparty_cuit
      : null;
  const numero = typeof payload.number === "number" ? payload.number : null;
  const puntoVenta =
    typeof payload.sales_point === "number" ? payload.sales_point : null;

  if (kind === "factura_compra" || kind === "nc_nd") {
    return matchDocument({
      table: "suppliers",
      cuit,
      numero,
      puntoVenta,
      invoiceTable: "purchase_invoices",
    });
  }
  if (kind === "factura_venta") {
    return matchDocument({
      table: "clients",
      cuit,
      numero,
      puntoVenta,
      invoiceTable: "invoices",
    });
  }
  if (kind === "orden_pago") return matchDocument({ table: "suppliers", cuit });
  if (kind === "recibo") return matchDocument({ table: "clients", cuit });
  if (kind === "extracto") {
    const reconciliation = await reconcileExtracto(payload);
    return reconciliation ? { reconciliation } : {};
  }
  return {};
}

/** Writes the extraction outcome back to the draft row (service role). */
export async function saveExtractionResult(
  extractionId: string,
  result: {
    detectedType: string;
    confidence: number | null;
    payload: unknown;
    matches: ExtractionMatches;
    status: ExtractionStatus;
  },
): Promise<void> {
  const service = getServiceClient();
  const { error } = await service
    .from("ai_document_extractions")
    .update({
      detected_type: result.detectedType,
      confidence: result.confidence,
      payload: toJson(result.payload),
      matches: toJson(result.matches),
      status: result.status,
    })
    .eq("id", extractionId);
  if (error) throw error;
}

/** Marks an extraction failed (terminal). Best-effort, never throws. */
export async function markExtractionFailed(extractionId: string): Promise<void> {
  const service = getServiceClient();
  const { error } = await service
    .from("ai_document_extractions")
    .update({ status: "failed" })
    .eq("id", extractionId);
  if (error) logger.error("ai.document.mark_failed.failed", { extractionId, error });
}
