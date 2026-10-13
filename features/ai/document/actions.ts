"use server";

import { z } from "zod";

import { ChequeCreateSchema } from "@/features/checks/schema";
import { isIvaCondition } from "@/features/clients/schema";
import { getUsdRateForDateAction } from "@/features/exchange-rates/actions/exchange-rates-actions";
import { issueFiscalInvoiceAction } from "@/features/invoices/actions/invoices-actions";
import { createPaymentOrderAction } from "@/features/payment-orders/actions/payment-orders-actions";
import { createPurchaseInvoiceAction } from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import { createReceiptAction } from "@/features/receipts/actions/receipts-actions";
import {
  CONCEPTO,
  DOC_TIPO,
  MONEDA,
  condicionIvaReceptorFor,
  isServiciosConcepto,
  type ConceptoCode,
} from "@/lib/afip/codes";
import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Json } from "@/lib/db/database.types";
import { buildStorageKey } from "@/lib/files/storage-path";
import { inngest } from "@/lib/inngest/client";
import { DOCUMENT_EXTRACTION_REQUESTED } from "@/lib/inngest/events";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { RateLimitError, enforceRateLimit } from "@/lib/rate-limit";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { checkAiDailyCap } from "../lib/chat-store";
import {
  buildPurchaseInvoiceInput,
  buildSalesInvoiceItems,
} from "./create-mapping";
import { InvoiceExtractionSchema } from "./schemas";
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

/** Per-user extraction budget (each one = 1–3 vision calls). */
const EXTRACTION_RATE_LIMITS = {
  hourly: { key: "ai:document:hourly", max: 30, windowMs: 60 * 60 * 1000 },
  daily: { key: "ai:document:daily", max: 200, windowMs: 24 * 60 * 60 * 1000 },
} as const;

/**
 * Spend guards for Document Intelligence, same style as the chat route:
 * per-user hourly/daily rate limit (Postgres-backed, fail-closed) + the global
 * daily AI token cap (fail-closed). Returns a user-facing error, or null.
 */
async function guardExtractionQuota(userId: string): Promise<string | null> {
  try {
    await enforceRateLimit({ userId, ...EXTRACTION_RATE_LIMITS.hourly });
    await enforceRateLimit({ userId, ...EXTRACTION_RATE_LIMITS.daily });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return "Alcanzaste el límite de escaneos con IA. Probá más tarde.";
    }
    throw err;
  }
  const cap = await checkAiDailyCap();
  if (cap === "exceeded") {
    return "Se alcanzó el límite diario de IA. Probá de nuevo mañana.";
  }
  if (cap === "unavailable") {
    return "No se pudo verificar el límite de IA. Probá de nuevo.";
  }
  return null;
}

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

  // Before the upload, so a blocked scan doesn't leave an orphaned file.
  const quotaError = await guardExtractionQuota(ctx.userId);
  if (quotaError) return { ok: false, error: quotaError };

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

  return startExtraction(ctx.userId, { fileId });
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

  const quotaError = await guardExtractionQuota(ctx.userId);
  if (quotaError) return { ok: false, error: quotaError };

  return startExtraction(ctx.userId, parsed.data);
}

/** Creates the draft + dispatches the pipeline. Callers did auth + quota. */
async function startExtraction(
  userId: string,
  input: z.infer<typeof ExtractInputSchema>,
): Promise<ActionResult<{ extractionId: string }>> {
  const supabase = await createSupabaseClient();

  // Verify the caller can actually see this file (RLS client) before kicking
  // off a service-role download + vision calls — the file_id is user-supplied
  // and the pipeline bypasses RLS.
  const { data: file } = await supabase
    .from("files")
    .select("id")
    .eq("id", input.fileId)
    .maybeSingle();
  if (!file) return { ok: false, error: "No encontramos el archivo." };

  const { data, error } = await supabase
    .from("ai_document_extractions")
    .insert({ file_id: input.fileId, created_by: userId })
    .select("id")
    .single();
  if (error) {
    logger.error("ai.document.create_draft.failed", {
      userId,
      error,
    });
    return { ok: false, error: "No se pudo iniciar la extracción." };
  }

  try {
    await inngest.send({
      name: DOCUMENT_EXTRACTION_REQUESTED,
      data: {
        extraction_id: data.id,
        file_id: input.fileId,
        declared_type: input.declaredType ?? null,
      },
    });
  } catch (err) {
    logger.error("ai.document.dispatch.failed", { userId, error: err });
    await supabase.from("ai_document_extractions").delete().eq("id", data.id);
    return { ok: false, error: "No se pudo iniciar la extracción." };
  }

  await logAudit(
    "ai.document.extraction_requested",
    userId,
    { file_id: input.fileId, declared_type: input.declaredType ?? null },
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
 * Creates a purchase invoice from a reviewed `purchase_invoice` extraction,
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
  if (ext.detected_type !== "purchase_invoice") {
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

  const created = await createWithClaim(supabase, parsed.data.extractionId, () =>
    createPurchaseInvoiceAction(built),
  );
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
    .eq("id", extractionId)
    .in("status", ["pending_review", "failed"]);
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
  source_client_id: z.string().uuid().nullable().optional(),
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
  const { extractionId, cartera_account_id, source_client_id, cheques } =
    parsed.data;

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
  if (ext.detected_type !== "check") {
    return { ok: false, error: "Solo se pueden crear cheques desde acá." };
  }

  // The check kind (fisico / echeq) is the cartera account's type, not a
  // separate choice — derive it authoritatively.
  const { data: acc } = await supabase
    .from("accounts")
    .select("type")
    .eq("id", cartera_account_id)
    .maybeSingle();
  if (!acc || (acc.type !== "checks" && acc.type !== "echeq")) {
    return { ok: false, error: "La cuenta de cartera no es válida." };
  }
  const kind = acc.type === "echeq" ? "echeq" : "fisico";

  // Claim before inserting anything: a double click gets "ya fue procesada"
  // instead of inserting the checks twice.
  if (!(await claimExtraction(supabase, extractionId))) {
    return { ok: false, error: ALREADY_PROCESSED };
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
      source_client_id: source_client_id ?? null,
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
      source_client_id: v.data.source_client_id ?? null,
      notes: v.data.notes ?? null,
      created_by: ctx.userId,
    });
    if (insErr) {
      errors.push({ index: i, error: "No se pudo guardar (¿número repetido?)." });
      continue;
    }
    created += 1;
  }

  if (created === 0) {
    await releaseExtraction(supabase, extractionId);
  } else {
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

// ---------------------------------------------------------------------------
// Create-from-extraction: receipt, payment order, sales invoice, NC/ND compra.
// Same shape as the purchase-invoice flow: load + guard the draft, map to the
// existing create action (which re-validates and enforces its own permission),
// then mark the extraction confirmed and audit.
// ---------------------------------------------------------------------------

type PendingExtractionRow = {
  detected_type: string | null;
  status: string;
  matches: Json;
  payload: Json;
};

/** Loads a draft and guards status + detected type. Returns an error string on failure. */
async function loadPendingForCreate(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  extractionId: string,
  expectedType: string,
): Promise<{ ext: PendingExtractionRow } | { error: string }> {
  const { data: ext, error } = await supabase
    .from("ai_document_extractions")
    .select("detected_type, status, matches, payload")
    .eq("id", extractionId)
    .maybeSingle();
  if (error || !ext) return { error: "No se encontró la extracción." };
  if (ext.status !== "pending_review") {
    return { error: "La extracción ya fue procesada." };
  }
  if (ext.detected_type !== expectedType) {
    return { error: "El tipo de documento no coincide con esta acción." };
  }
  return { ext };
}

function matchedId(matches: Json, key: "supplier_id" | "client_id"): string | null {
  return isRecord(matches) && typeof matches[key] === "string"
    ? matches[key]
    : null;
}

type ServerSupabase = Awaited<ReturnType<typeof createSupabaseClient>>;

const ALREADY_PROCESSED = "La extracción ya fue procesada.";

/**
 * Atomically claims a draft for creation: pending_review → confirmed, only if
 * it is still pending_review. Exactly one concurrent caller gets `true` (a
 * double click / second tab gets `false`), so the entity is created once.
 */
async function claimExtraction(
  supabase: ServerSupabase,
  extractionId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("ai_document_extractions")
    .update({ status: "confirmed" })
    .eq("id", extractionId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error) {
    logger.error("ai.document.claim.failed", { extractionId, error });
    return false;
  }
  return data !== null;
}

/** Undoes a claim whose creation failed, so the user can fix and retry. */
async function releaseExtraction(
  supabase: ServerSupabase,
  extractionId: string,
): Promise<void> {
  const { error } = await supabase
    .from("ai_document_extractions")
    .update({ status: "pending_review" })
    .eq("id", extractionId)
    .eq("status", "confirmed")
    .is("created_entity", null);
  if (error) {
    logger.error("ai.document.release.failed", { extractionId, error });
  }
}

/**
 * Claim → create → (release on failure). The create callback only runs for
 * the caller that won the claim; the up-front status read in each action is
 * just a fast path for a friendlier error.
 */
async function createWithClaim<T>(
  supabase: ServerSupabase,
  extractionId: string,
  create: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  if (!(await claimExtraction(supabase, extractionId))) {
    return { ok: false, error: ALREADY_PROCESSED };
  }
  let result: ActionResult<T>;
  try {
    result = await create();
  } catch (err) {
    await releaseExtraction(supabase, extractionId);
    throw err;
  }
  if (!result.ok) await releaseExtraction(supabase, extractionId);
  return result;
}

/** Links the created entity to the (already claimed) draft + audits. */
async function confirmExtraction(
  supabase: ServerSupabase,
  userId: string,
  extractionId: string,
  entity: { table: string; id: string },
): Promise<void> {
  await supabase
    .from("ai_document_extractions")
    .update({
      status: "confirmed",
      created_entity: { table: entity.table, id: entity.id },
    })
    .eq("id", extractionId);
  await logAudit(
    "ai.document.confirmed",
    userId,
    { extraction_id: extractionId, [`${entity.table}_id`]: entity.id },
    entity.id,
  );
}

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

const CreateReceiptFromExtractionSchema = z.object({
  extractionId: z.string().uuid(),
  channelId: z.string().min(1, "Canal requerido."),
  numero: z.number().int().positive("Número inválido."),
  receipt_date: dateString,
  total_amount: z.number().finite().gt(0, "Importe inválido."),
  currency: z.enum(["ARS", "USD"]),
  account_id: z.string().uuid("Cuenta requerida."),
});

/**
 * Creates a recibo from a reviewed `receipt` extraction: one payment line into
 * the chosen account for the full amount; allocations stay on FIFO auto.
 */
export async function createReceiptFromExtractionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read") || !userCan(ctx.roles, "receipts:write")) {
    return { ok: false, error: "No tenés permiso para crear recibos." };
  }
  const parsed = CreateReceiptFromExtractionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createSupabaseClient();
  const loaded = await loadPendingForCreate(
    supabase,
    parsed.data.extractionId,
    "receipt",
  );
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const clientId = matchedId(loaded.ext.matches, "client_id");
  if (!clientId) {
    return { ok: false, error: "Asociá un cliente antes de crear el recibo." };
  }

  const created = await createWithClaim(supabase, parsed.data.extractionId, () =>
    createReceiptAction({
      channel_id: parsed.data.channelId,
      numero: parsed.data.numero,
      client_id: clientId,
      receipt_date: parsed.data.receipt_date,
      total_amount: parsed.data.total_amount,
      currency: parsed.data.currency,
      notes: null,
      payment_lines: [
        { account_id: parsed.data.account_id, amount: parsed.data.total_amount },
      ],
      allocations: [],
      retentions: [],
    }),
  );
  if (!created.ok) return created;

  await confirmExtraction(supabase, ctx.userId, parsed.data.extractionId, {
    table: "receipts",
    id: created.data.id,
  });
  return { ok: true, data: { id: created.data.id } };
}

const CreatePaymentOrderFromExtractionSchema = z.object({
  extractionId: z.string().uuid(),
  channelId: z.string().min(1, "Canal requerido."),
  numero: z.number().int().positive("Número inválido."),
  payment_date: dateString,
  total_amount: z.number().finite().gt(0, "Importe inválido."),
  currency: z.enum(["ARS", "USD"]),
  account_id: z.string().uuid("Cuenta requerida."),
});

/**
 * Creates an orden de pago from a reviewed `payment_order` extraction: one
 * account payment line for the full amount; allocations stay on FIFO auto.
 */
export async function createPaymentOrderFromExtractionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.roles, "ai:read") ||
    !userCan(ctx.roles, "payment_orders:write")
  ) {
    return { ok: false, error: "No tenés permiso para crear órdenes de pago." };
  }
  const parsed = CreatePaymentOrderFromExtractionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createSupabaseClient();
  const loaded = await loadPendingForCreate(
    supabase,
    parsed.data.extractionId,
    "payment_order",
  );
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const supplierId = matchedId(loaded.ext.matches, "supplier_id");
  if (!supplierId) {
    return { ok: false, error: "Asociá un proveedor antes de crear la OP." };
  }

  const created = await createWithClaim(supabase, parsed.data.extractionId, () =>
    createPaymentOrderAction({
      channel_id: parsed.data.channelId,
      numero: parsed.data.numero,
      supplier_id: supplierId,
      payment_date: parsed.data.payment_date,
      total_amount: parsed.data.total_amount,
      currency: parsed.data.currency,
      notes: null,
      payment_lines: [
        {
          line_kind: "account",
          account_id: parsed.data.account_id,
          amount: parsed.data.total_amount,
        },
      ],
      allocations: [],
    }),
  );
  if (!created.ok) return created;

  await confirmExtraction(supabase, ctx.userId, parsed.data.extractionId, {
    table: "payment_orders",
    id: created.data.id,
  });
  return { ok: true, data: { id: created.data.id } };
}

const CreatePurchaseNoteFromExtractionSchema = z.object({
  extractionId: z.string().uuid(),
  channelId: z.string().min(1, "Canal requerido."),
  kind: z.enum(["nc", "nd"]),
  motivo: z.string().trim().min(1, "El motivo es requerido.").max(500),
});

/**
 * Creates a purchase NC/ND from a reviewed `credit_debit_note` extraction.
 * Scanned notes are received from suppliers, so they land on the purchase
 * side (kind nc/nd) — the sales side emits its own notes via AFIP.
 */
export async function createPurchaseNoteFromExtractionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.roles, "ai:read") ||
    !userCan(ctx.roles, "purchase_invoices:write")
  ) {
    return { ok: false, error: "No tenés permiso para crear NC/ND de compra." };
  }
  const parsed = CreatePurchaseNoteFromExtractionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createSupabaseClient();
  const loaded = await loadPendingForCreate(
    supabase,
    parsed.data.extractionId,
    "credit_debit_note",
  );
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const supplierId = matchedId(loaded.ext.matches, "supplier_id");
  if (!supplierId) {
    return { ok: false, error: "Asociá un proveedor antes de crear la nota." };
  }

  const built = buildPurchaseInvoiceInput(loaded.ext.payload, {
    channelId: parsed.data.channelId,
    supplierId,
    kind: parsed.data.kind,
    motivo: parsed.data.motivo,
  });
  if (!built) return { ok: false, error: "No se pudieron mapear los datos." };

  if (built.moneda === "DOL" && built.fecha) {
    const rate = await getUsdRateForDateAction(built.fecha);
    if (rate.ok && rate.data.rate) built.cotizacion = rate.data.rate;
  }

  const created = await createWithClaim(supabase, parsed.data.extractionId, () =>
    createPurchaseInvoiceAction(built),
  );
  if (!created.ok) return created;

  await confirmExtraction(supabase, ctx.userId, parsed.data.extractionId, {
    table: "purchase_invoices",
    id: created.data.id,
  });
  return { ok: true, data: { id: created.data.id } };
}

const CreateSalesInvoiceFromExtractionSchema = z.object({
  extractionId: z.string().uuid(),
  channelId: z.string().min(1, "Canal requerido."),
  puntoVenta: z.number().int().min(1, "Punto de venta requerido.").max(99999),
});

/**
 * Emits a sales invoice from a reviewed `sales_invoice` extraction through the
 * normal issue workflow (AFIP for fiscal channels, local numbering for
 * internal ones). The numero on the scan is NOT reused — the workflow reserves
 * the next one. Blocked when the scan matches an already-registered invoice.
 */
export async function createSalesInvoiceFromExtractionAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read") || !userCan(ctx.roles, "invoices:issue")) {
    return { ok: false, error: "No tenés permiso para emitir comprobantes." };
  }
  const parsed = CreateSalesInvoiceFromExtractionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createSupabaseClient();
  const loaded = await loadPendingForCreate(
    supabase,
    parsed.data.extractionId,
    "sales_invoice",
  );
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const clientId = matchedId(loaded.ext.matches, "client_id");
  if (!clientId) {
    return { ok: false, error: "Asociá un cliente antes de emitir la factura." };
  }
  if (isRecord(loaded.ext.matches) && loaded.ext.matches.duplicate_of) {
    return {
      ok: false,
      error: "Ese comprobante ya está registrado — no se vuelve a emitir.",
    };
  }

  const header = InvoiceExtractionSchema.safeParse(loaded.ext.payload);
  if (!header.success || !header.data.date) {
    return { ok: false, error: "La extracción no tiene fecha — revisala." };
  }
  const built = buildSalesInvoiceItems(loaded.ext.payload);
  if (!built) {
    return { ok: false, error: "No se pudieron mapear los ítems del comprobante." };
  }

  const [{ data: channel }, { data: client }] = await Promise.all([
    supabase
      .from("invoicing_channels")
      .select("id, division, is_fiscal")
      .eq("id", parsed.data.channelId)
      .maybeSingle(),
    supabase
      .from("clients")
      .select("id, cuit, iva_condition")
      .eq("id", clientId)
      .maybeSingle(),
  ]);
  if (!channel) return { ok: false, error: "Canal no existe." };
  if (!client?.cuit) {
    return { ok: false, error: "El cliente no tiene CUIT cargado." };
  }
  if (!isIvaCondition(client.iva_condition)) {
    return { ok: false, error: "El cliente no tiene condición de IVA válida." };
  }
  const ivaCondition = client.iva_condition;

  const fecha = header.data.date;
  const concepto: ConceptoCode =
    channel.division === "dz" ? CONCEPTO.PRODUCTOS_Y_SERVICIOS : CONCEPTO.SERVICIOS;
  const servicios = isServiciosConcepto(concepto);
  const moneda =
    header.data.currency === "USD" ? MONEDA.DOLARES : MONEDA.PESOS;
  let cotizacion = 1;
  if (moneda === MONEDA.DOLARES) {
    const rate = await getUsdRateForDateAction(fecha);
    if (rate.ok && rate.data.rate) cotizacion = rate.data.rate;
  }

  const created = await createWithClaim(supabase, parsed.data.extractionId, () =>
    issueFiscalInvoiceAction({
      channel_id: channel.id,
      client_id: client.id,
      kind: "factura",
      letter: null,
      punto_venta: parsed.data.puntoVenta,
      fecha,
      fch_serv_desde: servicios ? fecha : null,
      fch_serv_hasta: servicios ? fecha : null,
      fch_vto_pago: servicios ? (header.data.due_date ?? fecha) : null,
      concepto,
      doc_tipo: DOC_TIPO.CUIT,
      doc_nro: client.cuit,
      iva_condition_receptor: channel.is_fiscal
        ? condicionIvaReceptorFor(ivaCondition)
        : null,
      moneda,
      cotizacion,
      motivo_nc_nd: null,
      invoice_origin_id: null,
      items: built.items,
    }),
  );
  if (!created.ok) return created;

  await confirmExtraction(supabase, ctx.userId, parsed.data.extractionId, {
    table: "invoices",
    id: created.data.id,
  });
  return { ok: true, data: { id: created.data.id } };
}
