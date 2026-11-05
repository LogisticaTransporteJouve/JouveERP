import "server-only";

import type { Permission } from "@/lib/auth/permissions";
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
  /** The duplicate lookup failed: whether it is already loaded is unknown. */
  duplicate_unknown?: true;
  /** The uploader may not read the counterparty's table (or is unknown): the
   *  CUIT lookup did not run, so a missing client/supplier means "not
   *  checked", not "none". */
  counterparty_unchecked?: true;
  /** Expense classification suggestion (purchase_invoice). Human-confirmed. */
  expense?: ExpenseClassifyResult;
  /** Bank-statement reconciliation summary (extracto). */
  reconciliation?: ReconciliationSummary;
};

/** Whether the uploader may read a permission's data, resolved at scan time
 *  (roles minus denies). A comparison against data they may not read is not
 *  run, and nothing it would read is stored. */
export type CanRead = (permission: Permission) => boolean;

/**
 * Best-effort match of the extracted counterparty (by CUIT) to an existing
 * supplier/client, plus a duplicate check on (numero, punto_venta) for invoices.
 * Each part runs only if the uploader may read its source (`counterparty`,
 * `duplicates`). Never throws — matching is advisory for the review screen.
 */
export async function matchDocument(input: {
  table: "suppliers" | "clients";
  /** May read the suppliers / clients table. */
  counterparty: boolean;
  /** May read the invoice table the duplicate check reads. */
  duplicates?: boolean;
  cuit?: string | null;
  numero?: number | null;
  puntoVenta?: number | null;
  invoiceTable?: "purchase_invoices" | "invoices" | null;
  /** The comprobante kinds (factura | nc | nd) it can be; null for any. */
  kinds?: readonly InvoiceKind[] | null;
  /** Its letter, when the scan read one. */
  letter?: "A" | "B" | "C" | null;
}): Promise<ExtractionMatches> {
  const service = getServiceClient();
  const matches: ExtractionMatches = {};
  const invoiceTable = input.duplicates ? (input.invoiceTable ?? null) : null;
  // A check the uploader may not run is not "no duplicate" either (a sales
  // scan emits a CAE on "none"); it says nothing about the data.
  if (
    input.invoiceTable &&
    !invoiceTable &&
    input.numero != null &&
    input.puntoVenta != null
  ) {
    matches.duplicate_unknown = true;
  }
  if (input.cuit && !input.counterparty) {
    matches.counterparty_unchecked = true;
  }

  try {
    let matchedSupplierId: string | null = null;
    // A purchase's duplicate check needs the supplier even when its name is
    // not shown.
    if (
      input.cuit &&
      (input.counterparty || invoiceTable === "purchase_invoices")
    ) {
      const { data, error } = await service
        .from(input.table)
        .select("id, legal_name, cuit")
        .in("cuit", cuitCandidates(input.cuit))
        .limit(1);
      if (error) throw error;
      const row = data[0];
      if (row) {
        if (input.table === "suppliers") {
          matchedSupplierId = row.id;
          if (input.counterparty) {
            matches.supplier_id = row.id;
            matches.supplier_name = row.legal_name;
          }
        } else if (input.counterparty) {
          matches.client_id = row.id;
          matches.client_name = row.legal_name;
        }
      }
    }

    if (invoiceTable && input.numero != null && input.puntoVenta != null) {
      // The same key as the table's numbering uniqueness: each comprobante
      // type (factura, NC, ND) and letter has its own numbering, so a Factura
      // A and an NC A with the same number are two documents. A purchase
      // number is the SUPPLIER's (unique per supplier), so dedupe needs the
      // matched supplier (skip if we couldn't match one); our own sales
      // invoices are unique per punto_venta, which maps to one channel.
      const kinds = input.kinds ?? null;
      const letter = input.letter ?? null;
      if (invoiceTable === "purchase_invoices") {
        if (matchedSupplierId) {
          let q = service
            .from("purchase_invoices")
            .select("id")
            .eq("supplier_id", matchedSupplierId)
            .eq("numero", input.numero)
            .eq("punto_venta", input.puntoVenta);
          if (kinds) q = q.in("kind", kinds);
          if (letter) q = q.eq("letter", letter);
          const { data, error } = await q.limit(1);
          if (error) throw error;
          if (data[0]) matches.duplicate_of = data[0].id;
        }
      } else {
        let q = service
          .from("invoices")
          .select("id")
          .eq("numero", input.numero)
          .eq("punto_venta", input.puntoVenta);
        if (kinds) q = q.in("kind", kinds);
        if (letter) q = q.eq("letter", letter);
        const { data, error } = await q.limit(1);
        if (error) throw error;
        if (data[0]) matches.duplicate_of = data[0].id;
      }
    }
  } catch (err) {
    logger.error("ai.document.match.failed", { error: err });
    // A failed lookup is not "no duplicate": the review says it could not
    // check.
    if (invoiceTable) matches.duplicate_unknown = true;
  }

  return matches;
}

type InvoiceKind = "factura" | "nc" | "nd";

/** The comprobante kinds a scanned invoice can be: the type printed on it,
 *  else what the detected document implies (a note without its type read is
 *  either one), else any. */
export function comprobanteKinds(
  detected: string,
  printed: unknown,
): InvoiceKind[] | null {
  if (printed === "invoice") return ["factura"];
  if (printed === "credit_note") return ["nc"];
  if (printed === "debit_note") return ["nd"];
  if (detected === "credit_debit_note") return ["nc", "nd"];
  if (detected === "purchase_invoice" || detected === "sales_invoice") {
    return ["factura"];
  }
  return null;
}

/** Maps a detected kind + extracted payload to a counterparty/duplicate match,
 *  limited to what the uploader may read (`can`). */
export async function matchForKind(
  kind: string,
  payload: unknown,
  can: CanRead,
): Promise<ExtractionMatches> {
  if (!isRecord(payload)) return {};
  const cuit =
    typeof payload.counterparty_cuit === "string"
      ? payload.counterparty_cuit
      : null;
  const numero = typeof payload.number === "number" ? payload.number : null;
  const puntoVenta =
    typeof payload.sales_point === "number" ? payload.sales_point : null;
  const letter =
    payload.letter === "A" || payload.letter === "B" || payload.letter === "C"
      ? payload.letter
      : null;
  const kinds = comprobanteKinds(kind, payload.kind);

  if (kind === "purchase_invoice" || kind === "credit_debit_note") {
    return matchDocument({
      table: "suppliers",
      counterparty: can("suppliers:read"),
      duplicates: can("purchase_invoices:read"),
      cuit,
      numero,
      puntoVenta,
      invoiceTable: "purchase_invoices",
      kinds,
      letter,
    });
  }
  if (kind === "sales_invoice") {
    return matchDocument({
      table: "clients",
      counterparty: can("clients:read"),
      duplicates: can("invoices:read"),
      cuit,
      numero,
      puntoVenta,
      invoiceTable: "invoices",
      kinds,
      letter,
    });
  }
  if (kind === "payment_order") {
    return matchDocument({
      table: "suppliers",
      counterparty: can("suppliers:read"),
      cuit,
    });
  }
  if (kind === "receipt") {
    return matchDocument({
      table: "clients",
      counterparty: can("clients:read"),
      cuit,
    });
  }
  // Conciliación's own gate: the statement is compared with Caja.
  if (kind === "bank_statement" && can("transactions:read")) {
    const reconciliation = await reconcileExtracto(payload);
    return reconciliation ? { reconciliation } : {};
  }
  return {};
}

/**
 * Writes the extraction outcome back to the draft row (service role). A draft
 * the user discarded while the job was running stays discarded.
 */
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
    .eq("id", extractionId)
    .neq("status", "discarded");
  if (error) throw error;
}

/** Who requested an extraction: its usage and the access its matches run
 *  with. Null only for a missing row or uploader; a failed read throws, so
 *  the step retries instead of deciding on "unknown uploader". */
export async function extractionRequester(
  extractionId: string,
): Promise<string | null> {
  const service = getServiceClient();
  const { data, error } = await service
    .from("ai_document_extractions")
    .select("created_by")
    .eq("id", extractionId)
    .maybeSingle();
  if (error) throw error;
  return data?.created_by ?? null;
}

/**
 * Marks an extraction failed (terminal). Leaves a discarded draft alone.
 * Best-effort, never throws.
 */
export async function markExtractionFailed(
  extractionId: string,
): Promise<void> {
  const service = getServiceClient();
  const { error } = await service
    .from("ai_document_extractions")
    .update({ status: "failed" })
    .eq("id", extractionId)
    .neq("status", "discarded");
  if (error)
    logger.error("ai.document.mark_failed.failed", { extractionId, error });
}
