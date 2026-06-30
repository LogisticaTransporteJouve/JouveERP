import { classifyExpense } from "@/features/ai/document/classify-expense";
import {
  classifyDocument,
  extractDocument,
} from "@/features/ai/document/engine";
import { applyInvoicePostInference } from "@/features/ai/document/post-inference";
import {
  InvoiceExtractionSchema,
  isExtractableKind,
} from "@/features/ai/document/schemas";
import {
  downloadFileBytes,
  markExtractionFailed,
  matchForKind,
  saveExtractionResult,
} from "@/features/ai/document/store";
import { inngest } from "@/lib/inngest/client";
import { getServiceClient } from "@/lib/supabase/service";
import {
  DOCUMENT_EXTRACTION_REQUESTED,
  DocumentExtractionRequestedSchema,
} from "@/lib/inngest/events";
import { logger } from "@/lib/logger";

const INVOICE_KINDS = ["factura_compra", "factura_venta", "nc_nd"];

/**
 * Document Intelligence pipeline (docs/ai-overview.md §5-bis): classify (Haiku,
 * skipped in contextual mode) → extract (Sonnet, structured output) →
 * deterministic post-inference → match counterparty/duplicate → save the draft
 * as `pending_review`. The file bytes never cross a step boundary (they'd be
 * serialized): download + both vision calls run inside one step.
 */
export const documentExtraction = inngest.createFunction(
  {
    id: "document-extraction",
    name: "Document Intelligence — classify + extract",
    triggers: [{ event: DOCUMENT_EXTRACTION_REQUESTED }],
    idempotency: "event.data.extraction_id",
    retries: 2,
    onFailure: async ({ event, error }) => {
      const originalData = (event.data as { event?: { data?: unknown } }).event
        ?.data;
      const parsed = DocumentExtractionRequestedSchema.safeParse(originalData);
      if (!parsed.success) {
        logger.warn("document_extraction.failed_unparseable_event", {
          err: error.message,
        });
        return;
      }
      logger.warn("document_extraction.failed", {
        extraction_id: parsed.data.extraction_id,
        err: error.message,
      });
      await markExtractionFailed(parsed.data.extraction_id);
    },
  },
  async ({ event, step }) => {
    const { extraction_id, file_id, declared_type } =
      DocumentExtractionRequestedSchema.parse(event.data);

    const extracted = await step.run("classify-and-extract", async () => {
      const doc = await downloadFileBytes(file_id);

      let kind: string;
      let confidence: number | null;
      if (declared_type) {
        kind = declared_type;
        confidence = 1;
      } else {
        const classification = await classifyDocument(doc);
        kind = classification.tipo;
        confidence = classification.confianza;
      }

      let payload: unknown = {};
      if (isExtractableKind(kind)) {
        const raw = await extractDocument(kind, doc);
        if (INVOICE_KINDS.includes(kind)) {
          // generateObject already validated `raw` against this schema, so a
          // parse failure here is a real anomaly — fail (retry) rather than
          // silently save an un-post-inferred, inconsistent payload.
          const parsed = InvoiceExtractionSchema.safeParse(raw);
          if (!parsed.success) {
            throw new Error(
              `Extracción de factura inválida: ${parsed.error.message}`,
            );
          }
          payload = applyInvoicePostInference(parsed.data);
        } else {
          payload = raw;
        }
      }

      return { kind, confidence, payload };
    });

    const matches = await step.run("match", () =>
      matchForKind(extracted.kind, extracted.payload),
    );

    // Suggest the expense account (+ confirm cost center) for purchase invoices.
    // Suggestion-only: it rides on `matches.expense` for human review; nothing
    // posts differently until the account is confirmed.
    const expense =
      extracted.kind === "factura_compra"
        ? await step.run("classify-expense", async () => {
            const svc = getServiceClient();
            const [{ data: leaves }, { data: ccs }] = await Promise.all([
              svc.from("expense_leaf_accounts").select("code, name"),
              svc
                .from("cost_centers")
                .select("code, name")
                .eq("is_active", true),
            ]);

            let supplierCategory: string | null = null;
            if (matches.supplier_id) {
              const { data: sup } = await svc
                .from("suppliers")
                .select("category:supplier_categories(name)")
                .eq("id", matches.supplier_id)
                .maybeSingle();
              const cat = Array.isArray(sup?.category)
                ? sup?.category[0]
                : sup?.category;
              supplierCategory = cat?.name ?? null;
            }

            const inv = InvoiceExtractionSchema.safeParse(extracted.payload);
            return classifyExpense({
              supplierName: matches.supplier_name ?? null,
              supplierCategory,
              invoiceNeto: inv.success ? (inv.data.importe_neto ?? null) : null,
              lineDescriptions: inv.success
                ? inv.data.items.map((it) => it.descripcion).filter(Boolean)
                : [],
              leafAccounts: (leaves ?? []).flatMap((l) =>
                l.code !== null && l.name !== null
                  ? [{ code: l.code, name: l.name }]
                  : [],
              ),
              costCenters: ccs ?? [],
            });
          })
        : null;

    await step.run("save", async () => {
      await saveExtractionResult(extraction_id, {
        detectedType: extracted.kind,
        confidence: extracted.confidence,
        payload: extracted.payload,
        matches: expense ? { ...matches, expense } : matches,
        status: "pending_review",
      });
    });

    return { extraction_id, kind: extracted.kind };
  },
);
