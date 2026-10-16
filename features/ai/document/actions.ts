"use server";

import { z } from "zod";

import { ChequeCreateSchema } from "@/features/checks/schema";
import { isIvaCondition } from "@/features/clients/schema";
import { getUsdRateForDateAction } from "@/features/exchange-rates/actions/exchange-rates-actions";
import { issueFiscalInvoiceAction } from "@/features/invoices/actions/invoices-actions";
import { createPaymentOrderAction } from "@/features/payment-orders/actions/payment-orders-actions";
import {
  createPurchaseInvoiceAction,
  type PartialCreateFailure,
} from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import type {
  PurchaseInvoiceDraftData,
  PurchaseInvoiceDraftSource,
  PurchaseInvoiceDraftSupplier,
} from "@/features/purchase-invoices/lib/purchase-invoice-draft";
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
import { userCan, type Role } from "@/lib/auth/permissions";
import type { Json } from "@/lib/db/database.types";
import { buildStorageKey } from "@/lib/files/storage-path";
import { inngest } from "@/lib/inngest/client";
import { DOCUMENT_EXTRACTION_REQUESTED } from "@/lib/inngest/events";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { RateLimitError, enforceRateLimit } from "@/lib/rate-limit";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { checkAiDailyCap } from "../lib/chat-store";
import { attachSourceFile, type SourceFileTarget } from "./attach-source";
import {
  buildPurchaseInvoiceDraft,
  buildSalesInvoiceItems,
} from "./create-mapping";
import { InvoiceExtractionSchema } from "./schemas";
import { DOCUMENT_KINDS } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ServerSupabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/** Who confirms a draft, and whether they may attach its file to the result. */
type Actor = { userId: string; canAttach: boolean };

function actorOf(ctx: { userId: string; roles: readonly Role[] }): Actor {
  return { userId: ctx.userId, canAttach: userCan(ctx.roles, "files:write") };
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
 * extraction. The Documentos tray leaves the type to classification; a form
 * that already knows it (e.g. a new purchase invoice) sends `declaredType`.
 */
export async function scanDocumentAction(
  formData: FormData,
): Promise<ActionResult<{ extractionId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:read") || !userCan(ctx.roles, "files:write")) {
    return { ok: false, error: "No tenés permiso para escanear documentos." };
  }

  const declared = z
    .enum(DOCUMENT_KINDS)
    .nullable()
    .safeParse(formData.get("declaredType"));
  if (!declared.success) return { ok: false, error: "Datos inválidos." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Archivo faltante." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "El archivo supera 10 MB." };
  }
  if (!SCAN_ALLOWED_MIME.has(file.type)) {
    return {
      ok: false,
      error: `Tipo no permitido (${file.type || "desconocido"}).`,
    };
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

  return startExtraction(ctx.userId, {
    fileId,
    declaredType: declared.data,
  });
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

const PURCHASE_DRAFT_KINDS = ["purchase_invoice", "credit_debit_note"];

export type PurchaseInvoiceDraftState =
  | { state: "processing" }
  | { state: "failed" }
  | { state: "closed"; status: string }
  | { state: "unsupported"; detectedType: string }
  | {
      state: "ready";
      draft: PurchaseInvoiceDraftData;
      source: PurchaseInvoiceDraftSource;
    };

/**
 * The editable purchase-invoice draft for a scanned purchase invoice or
 * supplier NC/ND: the extraction mapped to the form, with the matched supplier
 * and the suggested expense account resolved. Polled while the pipeline runs.
 */
export async function getPurchaseInvoiceDraftAction(
  extractionId: string,
): Promise<ActionResult<PurchaseInvoiceDraftState>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.roles, "ai:read") ||
    !userCan(ctx.roles, "purchase_invoices:write")
  ) {
    return {
      ok: false,
      error: "No tenés permiso para cargar facturas de compra.",
    };
  }
  const id = z.string().uuid().safeParse(extractionId);
  if (!id.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createSupabaseClient();
  const { data: ext, error } = await supabase
    .from("ai_document_extractions")
    .select(
      "detected_type, status, confidence, matches, payload, file_id, created_entity, updated_at, file:files(original_filename, mime_type)",
    )
    .eq("id", id.data)
    .maybeSingle();
  if (error || !ext) {
    return { ok: false, error: "No se encontró la extracción." };
  }
  if (ext.status === "failed") return { ok: true, data: { state: "failed" } };
  const stale =
    ext.status === "confirmed" &&
    ext.created_entity === null &&
    (await releaseStaleClaim(supabase, id.data, ext.updated_at));
  if (ext.status !== "pending_review" && !stale) {
    return { ok: true, data: { state: "closed", status: ext.status } };
  }
  if (ext.detected_type === null) {
    return { ok: true, data: { state: "processing" } };
  }
  if (!PURCHASE_DRAFT_KINDS.includes(ext.detected_type)) {
    return {
      ok: true,
      data: { state: "unsupported", detectedType: ext.detected_type },
    };
  }

  const supplierId = matchedId(ext.matches, "supplier_id");
  const [supplier, expense] = await Promise.all([
    supplierId ? loadDraftSupplier(supabase, supplierId) : null,
    resolveExpenseSuggestion(supabase, ext.matches),
  ]);

  const header = InvoiceExtractionSchema.safeParse(ext.payload);
  let usdRate: number | null = null;
  if (header.success && header.data.currency === "USD" && header.data.date) {
    const rate = await getUsdRateForDateAction(header.data.date);
    usdRate = rate.ok ? rate.data.rate : null;
  }

  const draft = buildPurchaseInvoiceDraft(ext.payload, {
    fallbackKind: ext.detected_type === "credit_debit_note" ? "nc" : "factura",
    supplier,
    account: expense.account,
    costCenterId: expense.costCenterId,
    usdRate,
    confidence: ext.confidence,
    duplicate: isRecord(ext.matches) && Boolean(ext.matches.duplicate_of),
  });
  if (!draft) return { ok: false, error: "No se pudieron mapear los datos." };

  const file = Array.isArray(ext.file) ? ext.file[0] : ext.file;
  return {
    ok: true,
    data: {
      state: "ready",
      draft,
      source: {
        fileId: ext.file_id,
        filename: file?.original_filename ?? "documento",
        mimeType: file?.mime_type ?? null,
      },
    },
  };
}

async function loadDraftSupplier(
  supabase: ServerSupabase,
  supplierId: string,
): Promise<PurchaseInvoiceDraftSupplier | null> {
  const { data } = await supabase
    .from("suppliers")
    .select("id, legal_name, display_name, cuit, iva_condition")
    .eq("id", supplierId)
    .maybeSingle();
  if (!data || !isIvaCondition(data.iva_condition)) return null;
  return {
    id: data.id,
    legal_name: data.legal_name,
    display_name: data.display_name,
    cuit: data.cuit,
    iva_condition: data.iva_condition,
  };
}

/**
 * The expense suggestion (account/cost-center codes) → ids. Only a confident
 * suggestion carries an account; otherwise posting falls back to the compras
 * role.
 */
async function resolveExpenseSuggestion(
  supabase: ServerSupabase,
  matches: Json,
): Promise<{
  account: { id: string; label: string } | null;
  costCenterId: string | null;
}> {
  const expense =
    isRecord(matches) && isRecord(matches.expense) ? matches.expense : null;
  if (!expense) return { account: null, costCenterId: null };
  const accCode =
    typeof expense.accountCode === "string" ? expense.accountCode : null;
  const ccCode =
    typeof expense.costCenterCode === "string" ? expense.costCenterCode : null;

  const [acc, cc] = await Promise.all([
    accCode && accCode !== "UNMAPPED"
      ? supabase
          .from("chart_of_accounts")
          .select("id, code, name")
          .eq("code", accCode)
          .maybeSingle()
      : null,
    ccCode
      ? supabase
          .from("cost_centers")
          .select("id")
          .eq("code", ccCode)
          .maybeSingle()
      : null,
  ]);
  const account = acc?.data
    ? { id: acc.data.id, label: `${acc.data.code} — ${acc.data.name}` }
    : null;
  return { account, costCenterId: cc?.data?.id ?? null };
}

const CreatePurchaseInvoiceFromDraftSchema = z.object({
  extractionId: z.string().uuid(),
  // Validated by createPurchaseInvoiceAction, like a manual load.
  invoice: z.unknown(),
});

/**
 * Saves the reviewed purchase-invoice form of a scanned purchase invoice or
 * NC/ND: claims the draft, creates the invoice through the normal create
 * action (same validation and permission), attaches the scanned file to it
 * and confirms the draft. A failed create releases the draft for a retry.
 */
export async function createPurchaseInvoiceFromDraftAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.roles, "ai:read") ||
    !userCan(ctx.roles, "purchase_invoices:write")
  ) {
    return {
      ok: false,
      error: "No tenés permiso para cargar facturas de compra.",
    };
  }
  const parsed = CreatePurchaseInvoiceFromDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const supabase = await createSupabaseClient();
  const loaded = await loadPendingForCreate(
    supabase,
    parsed.data.extractionId,
    PURCHASE_DRAFT_KINDS,
  );
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const extraction = {
    id: parsed.data.extractionId,
    fileId: loaded.ext.file_id,
  };
  const created = await createWithClaim(supabase, extraction.id, () =>
    createPurchaseInvoiceAction(parsed.data.invoice),
  );
  if (!created.ok) {
    return linkPartialCreate(supabase, actorOf(ctx), extraction, {
      table: "purchase_invoices",
      failure: created,
    });
  }

  await confirmExtraction(supabase, actorOf(ctx), extraction, {
    table: "purchase_invoices",
    id: created.data.id,
  });
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
  const { data, error } = await supabase
    .from("ai_document_extractions")
    .update({ status: "discarded" })
    .eq("id", extractionId)
    .in("status", ["pending_review", "failed"])
    .select("id")
    .maybeSingle();
  if (error) {
    logger.error("ai.document.discard.failed", {
      userId: ctx.userId,
      extractionId,
      error,
    });
    return { ok: false, error: "No se pudo descartar." };
  }
  if (!data) {
    return {
      ok: false,
      error: "La extracción no existe o ya fue procesada.",
    };
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
): Promise<
  ActionResult<{ created: number; errors: { index: number; error: string }[] }>
> {
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
    .select("detected_type, status, file_id")
    .eq("id", extractionId)
    .maybeSingle();
  if (error || !ext)
    return { ok: false, error: "No se encontró la extracción." };
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
  const createdIds: string[] = [];

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
    const { data: inserted, error: insErr } = await supabase
      .from("checks")
      .insert({
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
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      errors.push({
        index: i,
        error: "No se pudo guardar (¿número repetido?).",
      });
      continue;
    }
    createdIds.push(inserted.id);
  }

  const created = createdIds.length;
  if (created === 0) {
    await releaseExtraction(supabase, extractionId);
  } else {
    const createdEntity: Json = { table: "checks", count: created };
    await supabase
      .from("ai_document_extractions")
      .update({ status: "confirmed", created_entity: createdEntity })
      .eq("id", extractionId);
    const actor = actorOf(ctx);
    if (actor.canAttach) {
      for (const id of createdIds) {
        await attachSourceFile(supabase, {
          fileId: ext.file_id,
          target: { table: "checks", id },
          userId: ctx.userId,
        });
      }
    }
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
// Create-from-extraction: receipt, payment order, sales invoice. Same shape as
// the purchase-invoice flow: load + guard the draft, map to the existing create
// action (which re-validates and enforces its own permission), then mark the
// extraction confirmed, attach its file to the entity and audit.
// ---------------------------------------------------------------------------

type PendingExtractionRow = {
  detected_type: string | null;
  status: string;
  matches: Json;
  payload: Json;
  file_id: string;
};

/** Loads a draft and guards status + detected type. Returns an error string on failure. */
async function loadPendingForCreate(
  supabase: ServerSupabase,
  extractionId: string,
  expectedTypes: readonly string[],
): Promise<{ ext: PendingExtractionRow } | { error: string }> {
  const { data: ext, error } = await supabase
    .from("ai_document_extractions")
    .select("detected_type, status, matches, payload, file_id")
    .eq("id", extractionId)
    .maybeSingle();
  if (error || !ext) return { error: "No se encontró la extracción." };
  if (ext.status !== "pending_review") {
    return { error: "La extracción ya fue procesada." };
  }
  if (
    ext.detected_type === null ||
    !expectedTypes.includes(ext.detected_type)
  ) {
    return { error: "El tipo de documento no coincide con esta acción." };
  }
  return { ext };
}

function matchedId(
  matches: Json,
  key: "supplier_id" | "client_id",
): string | null {
  return isRecord(matches) && typeof matches[key] === "string"
    ? matches[key]
    : null;
}

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

/** A claim older than this with nothing created was left by a crashed save. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * Returns a draft stuck as claimed (confirmed, nothing linked) for longer than
 * STALE_CLAIM_MS to pending_review, so it can be saved again. True if it did.
 */
async function releaseStaleClaim(
  supabase: ServerSupabase,
  extractionId: string,
  updatedAt: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  if (updatedAt >= cutoff) return false;
  const { data, error } = await supabase
    .from("ai_document_extractions")
    .update({ status: "pending_review" })
    .eq("id", extractionId)
    .eq("status", "confirmed")
    .is("created_entity", null)
    .lt("updated_at", cutoff)
    .select("id")
    .maybeSingle();
  if (error) {
    logger.error("ai.document.stale_release.failed", { extractionId, error });
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
 * just a fast path for a friendlier error. A partial failure (the entity row
 * was inserted, a later step failed) keeps the claim: releasing it would let
 * the user create the same document twice.
 */
async function createWithClaim<T>(
  supabase: ServerSupabase,
  extractionId: string,
  create: () => Promise<ActionResult<T> | PartialCreateFailure>,
): Promise<ActionResult<T> | PartialCreateFailure> {
  if (!(await claimExtraction(supabase, extractionId))) {
    return { ok: false, error: ALREADY_PROCESSED };
  }
  let result: ActionResult<T> | PartialCreateFailure;
  try {
    result = await create();
  } catch (err) {
    await releaseExtraction(supabase, extractionId);
    throw err;
  }
  if (!result.ok && !("createdId" in result)) {
    await releaseExtraction(supabase, extractionId);
  }
  return result;
}

/**
 * Failure branch after createWithClaim: when the entity row exists anyway, the
 * (still claimed) draft is linked to it so it isn't orphaned or re-created.
 * Returns the error for the caller either way.
 */
async function linkPartialCreate(
  supabase: ServerSupabase,
  actor: Actor,
  extraction: { id: string; fileId: string },
  opts: {
    table: SourceFileTarget["table"];
    failure: { ok: false; error: string } | PartialCreateFailure;
  },
): Promise<{ ok: false; error: string }> {
  if ("createdId" in opts.failure) {
    await confirmExtraction(supabase, actor, extraction, {
      table: opts.table,
      id: opts.failure.createdId,
    });
  }
  return { ok: false, error: opts.failure.error };
}

/**
 * Links the created entity to the (already claimed) draft, attaches the
 * scanned file to the entity and audits.
 */
async function confirmExtraction(
  supabase: ServerSupabase,
  actor: Actor,
  extraction: { id: string; fileId: string },
  entity: SourceFileTarget,
): Promise<void> {
  const link = () =>
    supabase
      .from("ai_document_extractions")
      .update({
        status: "confirmed",
        created_entity: { table: entity.table, id: entity.id },
      })
      .eq("id", extraction.id);
  const { error } = await link();
  if (error) {
    const retry = await link();
    if (retry.error) {
      // The entity exists; the draft keeps its claim (no re-create from it).
      logger.error("ai.document.confirm.failed", {
        extractionId: extraction.id,
        table: entity.table,
        entityId: entity.id,
        error: retry.error,
      });
    }
  }
  const attached = actor.canAttach
    ? await attachSourceFile(supabase, {
        fileId: extraction.fileId,
        target: entity,
        userId: actor.userId,
      })
    : false;
  await logAudit(
    "ai.document.confirmed",
    actor.userId,
    {
      extraction_id: extraction.id,
      [`${entity.table}_id`]: entity.id,
      file_attached: attached,
    },
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
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const loaded = await loadPendingForCreate(
    supabase,
    parsed.data.extractionId,
    ["receipt"],
  );
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const clientId = matchedId(loaded.ext.matches, "client_id");
  if (!clientId) {
    return { ok: false, error: "Asociá un cliente antes de crear el recibo." };
  }

  const created = await createWithClaim(
    supabase,
    parsed.data.extractionId,
    () =>
      createReceiptAction({
        channel_id: parsed.data.channelId,
        numero: parsed.data.numero,
        client_id: clientId,
        receipt_date: parsed.data.receipt_date,
        total_amount: parsed.data.total_amount,
        currency: parsed.data.currency,
        notes: null,
        payment_lines: [
          {
            account_id: parsed.data.account_id,
            amount: parsed.data.total_amount,
          },
        ],
        allocations: [],
        retentions: [],
      }),
  );
  if (!created.ok) return created;

  await confirmExtraction(
    supabase,
    actorOf(ctx),
    { id: parsed.data.extractionId, fileId: loaded.ext.file_id },
    { table: "receipts", id: created.data.id },
  );
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
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const loaded = await loadPendingForCreate(
    supabase,
    parsed.data.extractionId,
    ["payment_order"],
  );
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const supplierId = matchedId(loaded.ext.matches, "supplier_id");
  if (!supplierId) {
    return { ok: false, error: "Asociá un proveedor antes de crear la OP." };
  }

  const created = await createWithClaim(
    supabase,
    parsed.data.extractionId,
    () =>
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

  await confirmExtraction(
    supabase,
    actorOf(ctx),
    { id: parsed.data.extractionId, fileId: loaded.ext.file_id },
    { table: "payment_orders", id: created.data.id },
  );
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
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createSupabaseClient();
  const loaded = await loadPendingForCreate(
    supabase,
    parsed.data.extractionId,
    ["sales_invoice"],
  );
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const clientId = matchedId(loaded.ext.matches, "client_id");
  if (!clientId) {
    return {
      ok: false,
      error: "Asociá un cliente antes de emitir la factura.",
    };
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
    return {
      ok: false,
      error: "No se pudieron mapear los ítems del comprobante.",
    };
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
    channel.division === "dz"
      ? CONCEPTO.PRODUCTOS_Y_SERVICIOS
      : CONCEPTO.SERVICIOS;
  const servicios = isServiciosConcepto(concepto);
  const moneda = header.data.currency === "USD" ? MONEDA.DOLARES : MONEDA.PESOS;
  let cotizacion = 1;
  if (moneda === MONEDA.DOLARES) {
    const rate = await getUsdRateForDateAction(fecha);
    if (!rate.ok || !rate.data.rate) {
      return {
        ok: false,
        error:
          "No hay cotización del dólar para la fecha del comprobante. Cargala antes de emitir.",
      };
    }
    cotizacion = rate.data.rate;
  }

  const created = await createWithClaim(
    supabase,
    parsed.data.extractionId,
    () =>
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

  await confirmExtraction(
    supabase,
    actorOf(ctx),
    { id: parsed.data.extractionId, fileId: loaded.ext.file_id },
    { table: "invoices", id: created.data.id },
  );
  return { ok: true, data: { id: created.data.id } };
}
