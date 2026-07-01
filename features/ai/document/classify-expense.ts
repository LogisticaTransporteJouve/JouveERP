import "server-only";

import { generateObject } from "ai";
import { z } from "zod";

import { buildClassifierModel } from "@/features/ai/model";

// Anthropic constrained decoding can't build a grammar for a large z.enum (the
// COA-leaf list); jsonTool mode validates the tool args instead. Same option the
// extraction engine uses.
const ANTHROPIC_OBJECT_OPTIONS = {
  anthropic: { structuredOutputMode: "jsonTool" },
} as const;

const ATTEMPTS = 3;
export const UNMAPPED = "UNMAPPED";
const MIN_CONFIDENCE = 0.5;

export type ExpenseLeaf = { code: string; name: string };

export type ExpenseClassifyInput = {
  supplierName: string | null;
  supplierCategory: string | null; // suppliers.category -> name (the "hint")
  invoiceNeto: number | null;
  lineDescriptions: string[]; // extracted items[].descripcion
  leafAccounts: ExpenseLeaf[]; // public.expense_leaf_accounts
  costCenters: { code: string; name: string }[];
};

export type ExpenseClassifyResult = {
  accountCode: string; // a leaf code or UNMAPPED
  accountName: string | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  confidence: number; // 0..1
  reason: string;
};

function fail(reason: string): ExpenseClassifyResult {
  return {
    accountCode: UNMAPPED,
    accountName: null,
    costCenterCode: null,
    costCenterName: null,
    confidence: 0,
    reason,
  };
}

/** Prompt text — pure, exported for tests. */
export function buildExpensePrompt(i: ExpenseClassifyInput): string {
  const accs = i.leafAccounts.map((a) => `${a.code} — ${a.name}`).join("\n");
  const ccs = i.costCenters.map((c) => `${c.code} — ${c.name}`).join("\n");
  return [
    "You are a senior accountant. Classify this purchase invoice into the correct expense account.",
    `Supplier: ${i.supplierName ?? "—"} (category: ${i.supplierCategory ?? "—"})`,
    `Net amount: ${i.invoiceNeto ?? "—"}`,
    `Line detail:\n${i.lineDescriptions.map((d) => `- ${d}`).join("\n") || "—"}`,
    `AVAILABLE ACCOUNTS (choose exactly one, or "UNMAPPED" if none fits):\n${accs}`,
    `COST CENTERS:\n${ccs || "—"}`,
    'Return accountCode (a listed code or "UNMAPPED"), costCenterCode (or null), confidence (0..1) and a brief reason.',
  ].join("\n\n");
}

export async function classifyExpense(
  input: ExpenseClassifyInput,
): Promise<ExpenseClassifyResult> {
  if (input.leafAccounts.length === 0) {
    return fail("no leaf accounts");
  }

  const codes: [string, ...string[]] = [
    UNMAPPED,
    ...input.leafAccounts.map((a) => a.code),
  ];
  const [firstCc, ...restCc] = input.costCenters.map((c) => c.code);
  const ccSchema =
    firstCc !== undefined ? z.enum([firstCc, ...restCc]).nullable() : z.null();
  const schema = z.object({
    accountCode: z.enum(codes),
    costCenterCode: ccSchema,
    confidence: z.number().min(0).max(1),
    reason: z.string(),
  });

  const accountName = (code: string) =>
    input.leafAccounts.find((a) => a.code === code)?.name ?? null;
  const ccName = (code: string | null) =>
    code ? (input.costCenters.find((c) => c.code === code)?.name ?? null) : null;

  const base = buildExpensePrompt(input);
  let extra = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const { object } = await generateObject({
        model: buildClassifierModel(),
        schema,
        prompt: extra ? `${base}\n\n${extra}` : base,
        providerOptions: ANTHROPIC_OBJECT_OPTIONS,
      });
      // Low-confidence non-sentinel → demote to UNMAPPED (human decides).
      if (object.accountCode !== UNMAPPED && object.confidence < MIN_CONFIDENCE) {
        return {
          accountCode: UNMAPPED,
          accountName: null,
          costCenterCode: object.costCenterCode,
          costCenterName: ccName(object.costCenterCode),
          confidence: object.confidence,
          reason: `low confidence: ${object.reason}`,
        };
      }
      return {
        accountCode: object.accountCode,
        accountName:
          object.accountCode === UNMAPPED ? null : accountName(object.accountCode),
        costCenterCode: object.costCenterCode,
        costCenterName: ccName(object.costCenterCode),
        confidence: object.confidence,
        reason: object.reason,
      };
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      const schemaErr =
        name === "AI_NoObjectGeneratedError" || name === "AI_TypeValidationError";
      if (schemaErr) {
        extra =
          'CRITICAL: your previous response did not respect the schema. Return ONLY the JSON object with accountCode (a listed code or "UNMAPPED"), costCenterCode, confidence, reason.';
      }
      if (attempt === ATTEMPTS) return fail("exhausted retries");
      if (!schemaErr) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return fail("unreachable");
}
