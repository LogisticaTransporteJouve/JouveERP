"use server";

import { z } from "zod";

import {
  CHECK_CASH_DENIED_REASON,
  CHECK_CASH_PERMISSIONS,
} from "@/features/checks/lib/check-cash";
import { ChequeCreateSchema } from "@/features/checks/schema";
import { isIvaCondition } from "@/features/clients/schema";
import { getUsdRateForDateAction } from "@/features/exchange-rates/actions/exchange-rates-actions";
import { issueFiscalInvoiceAction } from "@/features/invoices/actions/invoices-actions";
import {
  createPaymentOrderAction,
  getPaymentOrderUsdRateAction,
} from "@/features/payment-orders/actions/payment-orders-actions";
import { createPurchaseInvoiceAction } from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import type {
  PurchaseInvoiceDraftData,
  PurchaseInvoiceDraftSource,
  PurchaseInvoiceDraftSupplier,
} from "@/features/purchase-invoices/lib/purchase-invoice-draft";
import {
  createReceiptAction,
  getReceiptUsdRateAction,
} from "@/features/receipts/actions/receipts-actions";
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
import { userCan, userCanAll, type Access } from "@/lib/auth/permissions";
import type { Json } from "@/lib/db/database.types";
import { buildStorageKey } from "@/lib/files/storage-path";
import { logger } from "@/lib/logger";
import type { UsdRate } from "@/lib/fx";
import { latestTributeSplits } from "@/lib/purchases/tribute-split";
import {
  type ClaimOutcome,
  createWithClaim as createWithClaimOn,
  type PartialCreateFailure,
} from "@/lib/actions/claim";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { isScannableMime } from "../attachments/limits";
import { attachSourceFile, type SourceFileTarget } from "./attach-source";
import {
  buildPurchaseInvoiceDraft,
  buildSalesInvoiceItems,
} from "./create-mapping";
import {
  DUPLICATE_UNKNOWN_MESSAGE,
  duplicateCheckOf,
  InvoiceExtractionSchema,
} from "./schemas";
import { guardExtractionQuota, startExtraction } from "./start";
import { DOCUMENT_KINDS } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ServerSupabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/** Who confirms a draft, and whether they may attach its file to the result. */
type Actor = { userId: string; canAttach: boolean };

function actorOf(ctx: { userId: string; access: Access }): Actor {
  return { userId: ctx.userId, canAttach: userCan(ctx.access, "files:write") };
}

const BUCKET = "files";
const MAX_BYTES = 10 * 1024 * 1024;

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
 * extraction. The Documentos tray leaves the type to classification; a form
 * that already knows it (e.g. a new purchase invoice) sends `declaredType`.
 */
export async function scanDocumentAction(
  formData: FormData,
): Promise<ActionResult<{ extractionId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:read") || !userCan(ctx.access, "files:write")) {
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
  if (!isScannableMime(file.type)) {
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
  if (!userCan(ctx.access, "ai:read") || !userCan(ctx.access, "files:write")) {
    return { ok: false, error: "No tenés permiso para escanear documentos." };
  }

  const parsed = ExtractInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const quotaError = await guardExtractionQuota(ctx.userId);
  if (quotaError) return { ok: false, error: quotaError };

  return startExtraction(ctx.userId, parsed.data);
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
  if (!userCan(ctx.access, "ai:read")) {
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

/** Full draft (with extracted payload) for the review screen. */
export async function getExtractionAction(
  extractionId: string,
): Promise<ActionResult<ExtractionDetail | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:read")) {
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
    !userCan(ctx.access, "ai:read") ||
    !userCan(ctx.access, "purchase_invoices:write")
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
  if (error) return draftReadFailed(id.data, error);
  if (!ext) return { ok: false, error: DRAFT_NOT_FOUND };
  if (ext.status === "failed") return { ok: true, data: { state: "failed" } };
  const release =
    ext.status === "confirmed" && ext.created_entity === null
      ? await releaseStaleClaim(supabase, {
          extractionId: id.data,
          updatedAt: ext.updated_at,
          kinds: PURCHASE_DRAFT_KINDS,
        })
      : "not_stale";
  if (release === "failed") return { ok: false, error: STALE_RELEASE_FAILED };
  if (ext.status !== "pending_review" && release !== "released") {
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
  const [supplierRead, expense] = await Promise.all([
    supplierId
      ? loadDraftSupplier(supabase, supplierId)
      : { ok: true as const, data: null },
    resolveExpenseSuggestion(supabase, ext.matches),
  ]);
  // A failed read is not "no supplier" or "no suggestion": the draft would
  // open without them and save to the compras account with no notice.
  if (!supplierRead.ok || !expense.ok) {
    logger.warn("ai_document.purchase_draft.read_failed", {
      userId: ctx.userId,
      extractionId: id.data,
    });
    return {
      ok: false,
      error: "No se pudo leer el proveedor o la cuenta sugerida. Reintentá.",
    };
  }
  const supplier = supplierRead.data;

  const header = InvoiceExtractionSchema.safeParse(ext.payload);
  let usdRate: number | null = null;
  if (header.success && header.data.currency === "USD" && header.data.date) {
    const rate = await getUsdRateForDateAction(header.data.date);
    usdRate = rate.ok ? rate.data.rate : null;
  }

  // Only for the otros tributos suggestion: a failed read suggests without it.
  const histories = supplier
    ? await latestTributeSplits(supabase, [supplier.id])
    : null;
  if (supplier && !histories) {
    logger.warn("ai_document.purchase_draft.tribute_history_failed", {
      userId: ctx.userId,
    });
  }
  const tributeHistory = (supplier && histories?.get(supplier.id)) || null;

  const draft = buildPurchaseInvoiceDraft(ext.payload, {
    fallbackKind: ext.detected_type === "credit_debit_note" ? "nc" : "factura",
    supplier,
    account: expense.data.account,
    costCenterId: expense.data.costCenterId,
    usdRate,
    confidence: ext.confidence,
    duplicate: duplicateCheckOf(ext.matches),
    tributeHistory,
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

type DraftRead<T> = { ok: true; data: T } | { ok: false };

async function loadDraftSupplier(
  supabase: ServerSupabase,
  supplierId: string,
): Promise<DraftRead<PurchaseInvoiceDraftSupplier | null>> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, legal_name, display_name, cuit, iva_condition")
    .eq("id", supplierId)
    .maybeSingle();
  if (error) return { ok: false };
  // A scanned invoice is a fiscal document: only a fiscal supplier fits.
  if (!data?.cuit || !isIvaCondition(data.iva_condition)) {
    return { ok: true, data: null };
  }
  return {
    ok: true,
    data: {
      id: data.id,
      legal_name: data.legal_name,
      display_name: data.display_name,
      cuit: data.cuit,
      iva_condition: data.iva_condition,
    },
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
): Promise<
  DraftRead<{
    account: { id: string; label: string } | null;
    costCenterId: string | null;
  }>
> {
  const expense =
    isRecord(matches) && isRecord(matches.expense) ? matches.expense : null;
  if (!expense)
    return { ok: true, data: { account: null, costCenterId: null } };
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
  if (acc?.error || cc?.error) return { ok: false };
  const account = acc?.data
    ? { id: acc.data.id, label: `${acc.data.code} — ${acc.data.name}` }
    : null;
  return { ok: true, data: { account, costCenterId: cc?.data?.id ?? null } };
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
    !userCan(ctx.access, "ai:read") ||
    !userCan(ctx.access, "purchase_invoices:write")
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
  if (!userCan(ctx.access, "ai:read")) {
    return { ok: false, error: "No tenés permiso." };
  }

  const supabase = await createSupabaseClient();
  const discard = () =>
    supabase
      .from("ai_document_extractions")
      .update({ status: "discarded" })
      .eq("id", extractionId);
  let { data, error } = await discard()
    .in("status", ["pending_review", "failed"])
    .select("id")
    .maybeSingle();
  // A claim left stale with nothing linked: its create may or may not have
  // run, so it is not retried (claimedMessage), but it can be put away.
  if (!error && !data) {
    ({ data, error } = await discard()
      .eq("status", "confirmed")
      .is("created_entity", null)
      .lt("updated_at", staleClaimCutoff())
      .select("id")
      .maybeSingle());
  }
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
  if (
    !userCan(ctx.access, "ai:read") ||
    !userCan(ctx.access, "cheques:write")
  ) {
    return { ok: false, error: "No tenés permiso para crear cheques." };
  }
  if (!userCanAll(ctx.access, CHECK_CASH_PERMISSIONS)) {
    return { ok: false, error: CHECK_CASH_DENIED_REASON };
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
    .select("detected_type, status, file_id, created_entity, updated_at")
    .eq("id", extractionId)
    .maybeSingle();
  if (error) return draftReadFailed(extractionId, error);
  if (!ext) return { ok: false, error: DRAFT_NOT_FOUND };
  // A stale cheque claim with nothing linked is retried: the link below is
  // retried, so a stale claim means the inserts did not finish, and a cheque
  // already inserted is refused by its bank + número key.
  const release =
    ext.status === "confirmed" && ext.created_entity === null
      ? await releaseStaleClaim(supabase, {
          extractionId,
          updatedAt: ext.updated_at,
          kinds: ["check"],
        })
      : "not_stale";
  if (release === "failed") return { ok: false, error: STALE_RELEASE_FAILED };
  if (
    (ext.status !== "pending_review" || ext.created_entity !== null) &&
    release !== "released"
  ) {
    return { ok: false, error: ALREADY_PROCESSED };
  }
  if (ext.detected_type !== "check") {
    return { ok: false, error: "Solo se pueden crear cheques desde acá." };
  }

  // The check kind (fisico / echeq) is the cartera account's type, not a
  // separate choice — derive it authoritatively.
  const { data: acc, error: accError } = await supabase
    .from("accounts")
    .select("type")
    .eq("id", cartera_account_id)
    .maybeSingle();
  if (accError) {
    logger.error("ai.document.checks.account_read_failed", {
      extractionId,
      error: accError,
    });
    return {
      ok: false,
      error: "No se pudo leer la cuenta de cartera. Reintentá.",
    };
  }
  if (!acc || (acc.type !== "checks" && acc.type !== "echeq")) {
    return { ok: false, error: "La cuenta de cartera no es válida." };
  }
  const kind = acc.type === "echeq" ? "echeq" : "fisico";

  // Claim before inserting anything: a double click gets "ya fue procesada"
  // instead of inserting the checks twice.
  const claim = await claimExtraction(supabase, extractionId);
  if (claim !== "won") {
    return {
      ok: false,
      error: claim === "failed" ? CLAIM_FAILED : ALREADY_PROCESSED,
    };
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
    await linkCreatedEntity(supabase, extractionId, {
      table: "checks",
      count: created,
    });
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
  created_entity: Json | null;
  updated_at: string;
};

/** Loads a draft and guards status + detected type. Returns an error string on failure. */
async function loadPendingForCreate(
  supabase: ServerSupabase,
  extractionId: string,
  expectedTypes: readonly string[],
): Promise<{ ext: PendingExtractionRow } | { error: string }> {
  const { data: ext, error } = await supabase
    .from("ai_document_extractions")
    .select(
      "detected_type, status, matches, payload, file_id, created_entity, updated_at",
    )
    .eq("id", extractionId)
    .maybeSingle();
  if (error) return { error: draftReadFailed(extractionId, error).error };
  if (!ext) return { error: DRAFT_NOT_FOUND };
  if (ext.status !== "pending_review" || ext.created_entity !== null) {
    return { error: claimedMessage(ext) };
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
const DRAFT_NOT_FOUND = "No se encontró la extracción.";
const DRAFT_READ_FAILED = "No se pudo leer el documento. Reintentá.";
const STALE_RELEASE_FAILED = "No se pudo reabrir el documento. Reintentá.";

function draftReadFailed(
  extractionId: string,
  error: unknown,
): { ok: false; error: string } {
  logger.error("ai.document.draft_read.failed", { extractionId, error });
  return { ok: false, error: DRAFT_READ_FAILED };
}
const CLAIM_FAILED = "No se pudo tomar el documento. Reintentá.";
const STALE_CLAIM_UNKNOWN =
  "Un intento anterior tomó este documento y no registró qué creó. Revisá si el comprobante ya existe; si no, descartá el documento y volvé a escanearlo.";

/** Why a draft is not open for creation. A claim older than STALE_CLAIM_MS
 *  with nothing linked may or may not have created its recibo, OP or
 *  factura (none has a key that would refuse a second one), so it is not
 *  released by itself: the user checks, and can discard it. */
function claimedMessage(ext: {
  status: string;
  created_entity: Json | null;
  updated_at: string;
}): string {
  return ext.status === "confirmed" &&
    ext.created_entity === null &&
    isStaleClaim(ext.updated_at)
    ? STALE_CLAIM_UNKNOWN
    : ALREADY_PROCESSED;
}

/**
 * Atomically claims a draft for creation: pending_review → confirmed, only if
 * it is still pending_review and nothing was created from it. Exactly one
 * concurrent caller gets "won" (a double click / second tab gets "lost"), so
 * the entity is created once. A failed update is "failed": nothing was made,
 * and the draft may still be pending (or claimed, if the update committed).
 */
async function claimExtraction(
  supabase: ServerSupabase,
  extractionId: string,
): Promise<ClaimOutcome> {
  const { data, error } = await supabase
    .from("ai_document_extractions")
    .update({ status: "confirmed" })
    .eq("id", extractionId)
    .eq("status", "pending_review")
    .is("created_entity", null)
    .select("id")
    .maybeSingle();
  if (error) {
    logger.error("ai.document.claim.failed", { extractionId, error });
    return "failed";
  }
  return data !== null ? "won" : "lost";
}

/** A claim older than this with nothing created was left by a crashed save. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

const staleClaimCutoff = () =>
  new Date(Date.now() - STALE_CLAIM_MS).toISOString();
const isStaleClaim = (updatedAt: string) => updatedAt < staleClaimCutoff();

/**
 * Returns a draft stuck as claimed (confirmed, nothing linked) for longer than
 * STALE_CLAIM_MS to pending_review, so it can be saved again. Only a draft of
 * the caller's kinds, whose create a key refuses twice: a recibo, OP or
 * factura claim stays closed (see claimedMessage).
 */
async function releaseStaleClaim(
  supabase: ServerSupabase,
  claim: { extractionId: string; updatedAt: string; kinds: readonly string[] },
): Promise<"released" | "not_stale" | "failed"> {
  const cutoff = staleClaimCutoff();
  if (claim.updatedAt >= cutoff) return "not_stale";
  const { data, error } = await supabase
    .from("ai_document_extractions")
    .update({ status: "pending_review" })
    .eq("id", claim.extractionId)
    .eq("status", "confirmed")
    .is("created_entity", null)
    .in("detected_type", [...claim.kinds])
    .lt("updated_at", cutoff)
    .select("id")
    .maybeSingle();
  if (error) {
    logger.error("ai.document.stale_release.failed", {
      extractionId: claim.extractionId,
      error,
    });
    return "failed";
  }
  return data !== null ? "released" : "not_stale";
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

/** Claim → create → (release on failure) on an extraction draft. The
 *  up-front status read in each action is just a fast path for a friendlier
 *  error; this claim is the guard. */
function createWithClaim<T>(
  supabase: ServerSupabase,
  extractionId: string,
  create: () => Promise<ActionResult<T> | PartialCreateFailure>,
): Promise<ActionResult<T> | PartialCreateFailure> {
  return createWithClaimOn({
    claim: () => claimExtraction(supabase, extractionId),
    release: () => releaseExtraction(supabase, extractionId),
    create,
    alreadyProcessed: ALREADY_PROCESSED,
    claimFailed: CLAIM_FAILED,
  });
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
 * Records what was created on the (already claimed) draft, retrying once. If
 * both writes fail, the entity exists and the draft keeps its claim, so
 * nothing is created from it again.
 */
async function linkCreatedEntity(
  supabase: ServerSupabase,
  extractionId: string,
  createdEntity:
    { table: string; id: string } | { table: string; count: number },
): Promise<void> {
  const link = () =>
    supabase
      .from("ai_document_extractions")
      .update({ status: "confirmed", created_entity: createdEntity })
      .eq("id", extractionId);
  const { error } = await link();
  if (!error) return;
  const retry = await link();
  if (retry.error) {
    logger.error("ai.document.confirm.failed", {
      extractionId,
      createdEntity,
      error: retry.error,
    });
  }
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
  await linkCreatedEntity(supabase, extraction.id, {
    table: entity.table,
    id: entity.id,
  });
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

/** Rate a USD recibo or OP is created with: the one loaded for its date. */
async function documentUsdRate(
  currency: "ARS" | "USD",
  fetchRate: () => Promise<ActionResult<UsdRate | null>>,
): Promise<ActionResult<number | null>> {
  if (currency !== "USD") return { ok: true, data: null };
  const res = await fetchRate();
  if (!res.ok) return res;
  if (!res.data) {
    return {
      ok: false,
      error:
        "No hay cotización del dólar para esa fecha. Cargala antes de crear el documento.",
    };
  }
  return { ok: true, data: res.data.rate };
}

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
  if (
    !userCan(ctx.access, "ai:read") ||
    !userCan(ctx.access, "receipts:write")
  ) {
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
  const cotizacion = await documentUsdRate(parsed.data.currency, () =>
    getReceiptUsdRateAction(parsed.data.receipt_date),
  );
  if (!cotizacion.ok) return cotizacion;

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
        cotizacion: cotizacion.data,
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
    !userCan(ctx.access, "ai:read") ||
    !userCan(ctx.access, "payment_orders:write")
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
  const cotizacion = await documentUsdRate(parsed.data.currency, () =>
    getPaymentOrderUsdRateAction(parsed.data.payment_date),
  );
  if (!cotizacion.ok) return cotizacion;

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
        cotizacion: cotizacion.data,
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
  if (
    !userCan(ctx.access, "ai:read") ||
    !userCan(ctx.access, "invoices:issue")
  ) {
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
  // The emission requests a CAE: a lookup that failed is not "no duplicate".
  const duplicate = duplicateCheckOf(loaded.ext.matches);
  if (duplicate === "found") {
    return {
      ok: false,
      error: "Ese comprobante ya está registrado — no se vuelve a emitir.",
    };
  }
  if (duplicate === "unknown") {
    return { ok: false, error: DUPLICATE_UNKNOWN_MESSAGE };
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

  const [channelRead, clientRead] = await Promise.all([
    supabase
      .from("invoicing_channels")
      .select("id, is_fiscal")
      .eq("id", parsed.data.channelId)
      .maybeSingle(),
    supabase
      .from("clients")
      .select("id, cuit, iva_condition")
      .eq("id", clientId)
      .maybeSingle(),
  ]);
  // A failed read is not a missing channel or a client without CUIT.
  if (channelRead.error || clientRead.error) {
    logger.warn("ai_document.sales_invoice.read_failed", {
      userId: ctx.userId,
      channelError: channelRead.error?.message,
      clientError: clientRead.error?.message,
    });
    return {
      ok: false,
      error: "No se pudo leer el canal o el cliente. Reintentá.",
    };
  }
  const channel = channelRead.data;
  const client = clientRead.data;
  if (!channel) return { ok: false, error: "Canal no existe." };
  if (!client?.cuit) {
    return { ok: false, error: "El cliente no tiene CUIT cargado." };
  }
  if (!isIvaCondition(client.iva_condition)) {
    return { ok: false, error: "El cliente no tiene condición de IVA válida." };
  }
  const ivaCondition = client.iva_condition;
  const clientCuit = client.cuit;

  const fecha = header.data.date;
  const concepto: ConceptoCode = CONCEPTO.SERVICIOS;
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
        doc_nro: clientCuit,
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
