"use server";

import { z } from "zod";

import { ChequeCreateSchema } from "@/features/checks/schema";
import { getUsdRateForDateAction } from "@/features/exchange-rates/actions/exchange-rates-actions";
import { createPurchaseInvoiceAction } from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Json } from "@/lib/db/database.types";
import { buildStorageKey } from "@/lib/files/storage-path";
import { inngest } from "@/lib/inngest/client";
import { DOCUMENT_EXTRACTION_REQUESTED } from "@/lib/inngest/events";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { buildPurchaseInvoiceInput } from "./create-mapping";
import { DOCUMENT_KINDS } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BUCKET = "files";
const MAX_BYTES = 10 * 1024 * 1024;
const SCAN_ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const ExtractInputSchema = z.object({
  fileId: z.string().uuid(),
  declaredType: z.enum(DOCUMENT_KINDS).nullish(),
});

export type ExtractionFile = {
  original_filename: string;
  mime_type: string | null;
} | null;

export type PendingExtraction = {
  id: string;
  file_id: string;
  detected_type: string | null;
  confidence: number | null;
  status: string;
  matches: Json;
  created_at: string;
  file: ExtractionFile;
};

export type ExtractionDetail = PendingExtraction & { payload: Json };

const LIST_COLUMNS =
  "id, file_id, detected_type, confidence, status, matches, created_at, file:files(original_filename, mime_type)";

/**
 * Uploads a standalone document (not attached to any entity yet) and kicks off
 * extraction — the entry point for the generic Documentos tray. The document
 * type is inferred (classification); contextual flows pass a fileId straight to
 * extractDocumentAction.
 */
export async function scanDocumentAction(
  formData: FormData,
): Promise<ActionResult<{ extractionId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read") || !userCan(ctx.roles, "files:write")) {
    return { ok: false, error: "No tenés permiso para escanear documentos." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Archivo faltante." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "El archivo supera 10 MB." };
  }
  if (!SCAN_ALLOWED_MIME.has(file.type)) {
    return { ok: false, error: `Tipo no permitido (${file.type || "desconocido"}).` };
  }

  const supabase = await createSupabaseClient();
  const fileId = crypto.randomUUID();
  const bucketPath = buildStorageKey(fileId, file.name);

  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .upload(bucketPath, file, { cacheControl: "3600", upsert: false });
  if (storageErr) {
    logger.warn("ai.document.upload.storage_failed", {
      userId: ctx.userId,
      error: storageErr.message,
    });
    return { ok: false, error: "No se pudo subir el archivo." };
  }

  const { error: registryErr } = await supabase.from("files").insert({
    id: fileId,
    uploaded_by: ctx.userId,
    original_filename: file.name,
    mime_type: file.type,
    file_size: file.size,
    bucket: BUCKET,
    bucket_path: bucketPath,
    source: "document_scan",
  });
  if (registryErr) {
    await supabase.storage.from(BUCKET).remove([bucketPath]);
    logger.warn("ai.document.upload.registry_failed", {
      userId: ctx.userId,
      error: registryErr.message,
    });
    return { ok: false, error: "No se pudo registrar el archivo." };
  }

  return extractDocumentAction({ fileId });
}

/**
 * Triggers Document Intelligence on an uploaded file: creates the draft row and
 * dispatches the Inngest pipeline (classify → extract → match → save).
 */
export async function extractDocumentAction(
  input: unknown,
): Promise<ActionResult<{ extractionId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read") || !userCan(ctx.roles, "files:write")) {
    return { ok: false, error: "No tenés permiso para escanear documentos." };
  }

  const parsed = ExtractInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createSupabaseClient();

  // Verify the caller can actually see this file (RLS client) before kicking
  // off a service-role download + vision calls — the file_id is user-supplied
  // and the pipeline bypasses RLS.
  const { data: file } = await supabase
    .from("files")
    .select("id")
    .eq("id", parsed.data.fileId)
    .maybeSingle();
  if (!file) return { ok: false, error: "No encontramos el archivo." };

  const { data, error } = await supabase
    .from("ai_document_extractions")
    .insert({ file_id: parsed.data.fileId, created_by: ctx.userId })
    .select("id")
    .single();
  if (error) {
    logger.error("ai.document.create_draft.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo iniciar la extracción." };
  }

  try {
    await inngest.send({
      name: DOCUMENT_EXTRACTION_REQUESTED,
      data: {
        extraction_id: data.id,
        file_id: parsed.data.fileId,
        declared_type: parsed.data.declaredType ?? null,
      },
    });
  } catch (err) {
    logger.error("ai.document.dispatch.failed", { userId: ctx.userId, error: err });
    await supabase.from("ai_document_extractions").delete().eq("id", data.id);
    return { ok: false, error: "No se pudo iniciar la extracción." };
  }

  await logAudit(
    "ai.document.extraction_requested",
    ctx.userId,
    { file_id: parsed.data.fileId, declared_type: parsed.data.declaredType ?? null },
    data.id,
  );
  return { ok: true, data: { extractionId: data.id } };
}

const LIST_STATUSES = [
  "pending_review",
  "confirmed",
  "discarded",
  "failed",
  "all",
] as const;

/** Lists the caller's extractions for a status tab (RLS scoped; ai:admin sees all). */
export async function listExtractionsAction(
  status: string,
): Promise<ActionResult<PendingExtraction[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read")) {
    return { ok: false, error: "No tenés permiso." };
  }

  const valid = (LIST_STATUSES as readonly string[]).includes(status)
    ? status
    : "pending_review";

  const supabase = await createSupabaseClient();
  let query = supabase
    .from("ai_document_extractions")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(100);
  if (valid !== "all") query = query.eq("status", valid);

  const { data, error } = await query;
  if (error) {
    logger.error("ai.document.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar los documentos." };
  }
  return { ok: true, data: data ?? [] };
}

/** Lists the caller's drafts still awaiting review (RLS scoped; ai:admin sees all). */
export async function listPendingExtractionsAction(): Promise<
  ActionResult<PendingExtraction[]>
> {
  return listExtractionsAction("pending_review");
}

/** Full draft (with extracted payload) for the review screen. */
export async function getExtractionAction(
  extractionId: string,
): Promise<ActionResult<ExtractionDetail | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read")) {
    return { ok: false, error: "No tenés permiso." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("ai_document_extractions")
    .select(`${LIST_COLUMNS}, payload`)
    .eq("id", extractionId)
    .maybeSingle();
  if (error) {
    logger.error("ai.document.get.failed", {
      userId: ctx.userId,
      extractionId,
      error,
    });
    return { ok: false, error: "No se pudo cargar el documento." };
  }
  return { ok: true, data: data ?? null };
}

const CreateFromExtractionSchema = z.object({
  extractionId: z.string().uuid(),
  channelId: z.string().min(1),
});

/**
 * Creates a purchase invoice from a reviewed `factura_compra` extraction,
 * reusing the existing create action (which re-validates everything). Requires
 * a matched supplier and a chosen channel. On success the draft is marked
 * confirmed with a link to the created entity.
 */
export async function createPurchaseInvoiceFromExtractionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.roles, "ai:read") ||
    !userCan(ctx.roles, "purchase_invoices:write")
  ) {
    return { ok: false, error: "No tenés permiso para crear facturas de compra." };
  }

  const parsed = CreateFromExtractionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createSupabaseClient();
  const { data: ext, error } = await supabase
    .from("ai_document_extractions")
    .select("detected_type, status, matches, payload")
    .eq("id", parsed.data.extractionId)
    .maybeSingle();
  if (error || !ext) return { ok: false, error: "No se encontró la extracción." };
  if (ext.status !== "pending_review") {
    return { ok: false, error: "La extracción ya fue procesada." };
  }
  if (ext.detected_type !== "factura_compra") {
    return { ok: false, error: "Solo se puede crear factura de compra desde acá." };
  }

  const supplierId =
    isRecord(ext.matches) && typeof ext.matches.supplier_id === "string"
      ? ext.matches.supplier_id
      : null;
  if (!supplierId) {
    return { ok: false, error: "Asociá un proveedor antes de crear la factura." };
  }

  // Resolve the confirmed expense suggestion (codes) → ids so the invoice posts
  // to the suggested account/cost center. Only confident suggestions carry an
  // account (else UNMAPPED → no account → posting falls back to the compras role).
  let accountId: string | null = null;
  let costCenterId: string | null = null;
  const expense =
    isRecord(ext.matches) && isRecord(ext.matches.expense)
      ? ext.matches.expense
      : null;
  if (expense) {
    const accCode =
      typeof expense.accountCode === "string" ? expense.accountCode : null;
    const ccCode =
      typeof expense.costCenterCode === "string" ? expense.costCenterCode : null;
    if (accCode && accCode !== "UNMAPPED") {
      const { data: acc } = await supabase
        .from("chart_of_accounts")
        .select("id")
        .eq("code", accCode)
        .maybeSingle();
      accountId = acc?.id ?? null;
    }
    if (ccCode) {
      const { data: cc } = await supabase
        .from("cost_centers")
        .select("id")
        .eq("code", ccCode)
        .maybeSingle();
      costCenterId = cc?.id ?? null;
    }
  }

  const built = buildPurchaseInvoiceInput(ext.payload, {
    channelId: parsed.data.channelId,
    supplierId,
    accountId,
    costCenterId,
  });
  if (!built) return { ok: false, error: "No se pudieron mapear los datos." };

  // USD invoice: pre-fill the exchange rate for the invoice date so the ledger
  // posts ARS (the emitter converts by cotizacion). Left at 1 if no rate is
  // configured — the human confirms before creating.
  if (built.moneda === "DOL" && built.fecha) {
    const rate = await getUsdRateForDateAction(built.fecha);
    if (rate.ok && rate.data.rate) built.cotizacion = rate.data.rate;
  }

  const created = await createPurchaseInvoiceAction(built);
  if (!created.ok) return created;

  await supabase
    .from("ai_document_extractions")
    .update({
      status: "confirmed",
      created_entity: { table: "purchase_invoices", id: created.data.id },
    })
    .eq("id", parsed.data.extractionId);

  await logAudit(
    "ai.document.confirmed",
    ctx.userId,
    {
      extraction_id: parsed.data.extractionId,
      purchase_invoice_id: created.data.id,
    },
    created.data.id,
  );
  return { ok: true, data: { id: created.data.id } };
}

/** Discards a draft without creating anything. */
export async function discardExtractionAction(
  extractionId: string,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read")) {
    return { ok: false, error: "No tenés permiso." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("ai_document_extractions")
    .update({ status: "discarded" })
    .eq("id", extractionId);
  if (error) {
    logger.error("ai.document.discard.failed", {
      userId: ctx.userId,
      extractionId,
      error,
    });
    return { ok: false, error: "No se pudo descartar." };
  }

  await logAudit("ai.document.discarded", ctx.userId, {}, extractionId);
  return { ok: true, data: undefined };
}

const ChequeRowSchema = z.object({
  banco: z.string().nullish(),
  serie: z.string().nullish(),
  numero: z.string().nullish(),
  librador: z.string().nullish(),
  librador_cuit: z.string().nullish(),
  importe: z.number().nullish(),
  fecha: z.string().nullish(),
  fecha_pago: z.string().nullish(),
  moneda: z.string().nullish(),
});

const CreateChecksFromExtractionSchema = z.object({
  extractionId: z.string().uuid(),
  cartera_account_id: z.string().uuid("Cuenta de cartera requerida."),
  kind: z.enum(["fisico", "echeq"]),
  cheques: z.array(ChequeRowSchema).min(1).max(100),
});

/**
 * Create one or several checks (en cartera) from a cheque extraction. Each row
 * (already human-edited in the review) is mapped to the manual-check schema and
 * inserted independently, so a bad row reports its error without dropping the
 * rest. Marks the extraction confirmed when at least one check is created.
 */
export async function createChecksFromExtractionAction(
  input: unknown,
): Promise<ActionResult<{ created: number; errors: { index: number; error: string }[] }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read") || !userCan(ctx.roles, "cheques:write")) {
    return { ok: false, error: "No tenés permiso para crear cheques." };
  }
  const parsed = CreateChecksFromExtractionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { extractionId, cartera_account_id, kind, cheques } = parsed.data;

  const supabase = await createSupabaseClient();
  const { data: ext, error } = await supabase
    .from("ai_document_extractions")
    .select("detected_type, status")
    .eq("id", extractionId)
    .maybeSingle();
  if (error || !ext) return { ok: false, error: "No se encontró la extracción." };
  if (ext.status !== "pending_review") {
    return { ok: false, error: "La extracción ya fue procesada." };
  }
  if (ext.detected_type !== "cheque") {
    return { ok: false, error: "Solo se pueden crear cheques desde acá." };
  }

  const errors: { index: number; error: string }[] = [];
  let created = 0;

  for (const [i, row] of cheques.entries()) {
    const candidate = {
      kind,
      check_number: row.numero ?? "",
      bank_name: row.banco ?? "",
      drawer_name: row.librador ?? "",
      drawer_cuit: row.librador_cuit ?? "",
      issue_date: row.fecha ?? "",
      due_date: row.fecha_pago ?? row.fecha ?? "",
      amount: row.importe ?? 0,
      currency: row.moneda === "USD" ? "USD" : "ARS",
      cartera_account_id,
      source_kind: "manual",
      notes: row.serie ? `Serie ${row.serie}` : null,
    };
    const v = ChequeCreateSchema.safeParse(candidate);
    if (!v.success) {
      errors.push({
        index: i,
        error: v.error.issues[0]?.message ?? "Datos inválidos.",
      });
      continue;
    }
    const { error: insErr } = await supabase.from("checks").insert({
      kind: v.data.kind,
      check_number: v.data.check_number,
      bank_name: v.data.bank_name,
      drawer_name: v.data.drawer_name,
      drawer_cuit: v.data.drawer_cuit ?? null,
      issue_date: v.data.issue_date,
      due_date: v.data.due_date,
      amount: v.data.amount,
      currency: v.data.currency,
      cartera_account_id: v.data.cartera_account_id,
      status: "en_cartera",
      source_kind: v.data.source_kind,
      notes: v.data.notes ?? null,
      created_by: ctx.userId,
    });
    if (insErr) {
      errors.push({ index: i, error: "No se pudo guardar (¿número repetido?)." });
      continue;
    }
    created += 1;
  }

  if (created > 0) {
    const createdEntity: Json = { table: "checks", count: created };
    await supabase
      .from("ai_document_extractions")
      .update({ status: "confirmed", created_entity: createdEntity })
      .eq("id", extractionId);
    await logAudit(
      "ai.document.confirmed",
      ctx.userId,
      { extraction_id: extractionId, checks_created: created },
      extractionId,
    );
  }

  return { ok: true, data: { created, errors } };
}
