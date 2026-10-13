import {
  classifyExpense,
  type ExpenseClassifyResult,
} from "@/features/ai/document/classify-expense";
import {
  classifyDocument,
  extractDocument,
  type UsageSink,
} from "@/features/ai/document/engine";
import { applyInvoicePostInference } from "@/features/ai/document/post-inference";
import {
  InvoiceExtractionSchema,
  isExtractableKind,
} from "@/features/ai/document/schemas";
import {
  downloadFileBytes,
  extractionRequester,
  markExtractionFailed,
  matchForKind,
  saveExtractionResult,
  type ExtractionMatches,
} from "@/features/ai/document/store";
import { recordAiUsage } from "@/features/ai/lib/chat-store";
import { AI_TITLE_MODEL } from "@/features/ai/model";
import { inngest } from "@/lib/inngest/client";
import { getServiceClient } from "@/lib/supabase/service";
import {
  DOCUMENT_EXTRACTION_REQUESTED,
  DocumentExtractionRequestedSchema,
} from "@/lib/inngest/events";
import { logger } from "@/lib/logger";

const INVOICE_KINDS = [
  "purchase_invoice",
  "sales_invoice",
  "credit_debit_note",
];

/**
 * Collects the token usage of a step's model calls and writes it to ai_usage
 * (attributed to the requester) so Document Intelligence counts toward the
 * daily AI cap. Flushed in a `finally` inside the step: a failed attempt was
 * still billed, and a retried step re-bills.
 */
function usageMeter(userId: string | null): {
  sink: UsageSink;
  flush: () => Promise<void>;
} {
  const pending: Array<Promise<void>> = [];
  return {
    sink: (kind, model, usage) => {
      pending.push(recordAiUsage({ kind, model, userId, ...usage }));
    },
    flush: async () => {
      await Promise.all(pending);
    },
  };
}

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

    const requester = await step.run("requester", () =>
      extractionRequester(extraction_id),
    );

    const extracted = await step.run("classify-and-extract", async () => {
      const meter = usageMeter(requester);
      try {
        return await classifyAndExtract(file_id, declared_type, meter.sink);
      } finally {
        await meter.flush();
      }
    });

    const matches = await step.run("match", () =>
      matchForKind(extracted.kind, extracted.payload),
    );

    // Suggest the expense account (+ confirm cost center) for purchase invoices.
    // Suggestion-only: it rides on `matches.expense` for human review; nothing
    // posts differently until the account is confirmed.
    const expense =
      extracted.kind === "purchase_invoice"
        ? await step.run("classify-expense", async () => {
            const meter = usageMeter(requester);
            try {
              return await suggestExpense(
                extracted.payload,
                matches,
                meter.sink,
              );
            } finally {
              await meter.flush();
            }
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

/** Download + classify (unless declared) + extract + post-inference. */
async function classifyAndExtract(
  fileId: string,
  declaredType: string | null | undefined,
  onUsage: UsageSink,
): Promise<{ kind: string; confidence: number | null; payload: unknown }> {
  const doc = await downloadFileBytes(fileId);

  let kind: string;
  let confidence: number | null;
  if (declaredType) {
    kind = declaredType;
    confidence = 1;
  } else {
    const classification = await classifyDocument(doc, { onUsage });
    kind = classification.type;
    confidence = classification.confidence;
  }

  let payload: unknown = {};
  if (isExtractableKind(kind)) {
    const raw = await extractDocument(kind, doc, { onUsage });
    if (INVOICE_KINDS.includes(kind)) {
      // The extraction already validated `raw` against this schema, so a
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
}

/** Expense account / cost center suggestion for a purchase invoice. */
async function suggestExpense(
  payload: unknown,
  matches: ExtractionMatches,
  onUsage: UsageSink,
): Promise<ExpenseClassifyResult> {
  const svc = getServiceClient();
  const [{ data: leaves }, { data: ccs }] = await Promise.all([
    svc.from("expense_leaf_accounts").select("code, name"),
    svc.from("cost_centers").select("code, name").eq("is_active", true),
  ]);

  let supplierCategory: string | null = null;
  if (matches.supplier_id) {
    const { data: sup } = await svc
      .from("suppliers")
      .select("category:supplier_categories(name)")
      .eq("id", matches.supplier_id)
      .maybeSingle();
    const cat = Array.isArray(sup?.category) ? sup?.category[0] : sup?.category;
    supplierCategory = cat?.name ?? null;
  }

  const inv = InvoiceExtractionSchema.safeParse(payload);
  return classifyExpense(
    {
      supplierName: matches.supplier_name ?? null,
      supplierCategory,
      invoiceNeto: inv.success ? (inv.data.net_amount ?? null) : null,
      lineDescriptions: inv.success
        ? inv.data.items.map((it) => it.description).filter(Boolean)
        : [],
      leafAccounts: (leaves ?? []).flatMap((l) =>
        l.code !== null && l.name !== null
          ? [{ code: l.code, name: l.name }]
          : [],
      ),
      costCenters: ccs ?? [],
    },
    {
      onUsage: (usage) => onUsage("expense_classify", AI_TITLE_MODEL, usage),
    },
  );
}
