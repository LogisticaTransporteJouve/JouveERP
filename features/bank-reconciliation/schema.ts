import { z } from "zod";

// Conciliación bancaria (roadmap 5.4): the lines of an imported bank
// statement (bank_statement_lines) matched against the account's movements
// (transactions), per account and period
// (supabase/migrations/20261103140000_bank_reconciliation.sql).

export const STATEMENT_LINE_STATUSES = ["open", "matched", "ignored"] as const;
export type StatementLineStatus = (typeof STATEMENT_LINE_STATUSES)[number];

export const STATEMENT_LINE_STATUS_LABELS: Record<StatementLineStatus, string> =
  {
    open: "Pendiente",
    matched: "Conciliada",
    ignored: "No corresponde",
  };

export function isStatementLineStatus(
  value: unknown,
): value is StatementLineStatus {
  return (
    typeof value === "string" &&
    (STATEMENT_LINE_STATUSES as readonly string[]).includes(value)
  );
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

/** Days around a line's date a movement may be suggested from. */
export const SUGGESTION_DAY_WINDOW = 5;

/** Days around the period whose movements the manual match offers. */
export const CANDIDATE_DAY_WINDOW = 15;

export const ReconciliationQuerySchema = z
  .object({
    account_id: z.string().uuid("Elegí la cuenta."),
    from: isoDate,
    to: isoDate,
  })
  .refine((q) => q.from <= q.to, {
    message: "El período termina antes de empezar.",
    path: ["to"],
  })
  .refine(
    (q) =>
      Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`) <=
      366 * 24 * 60 * 60 * 1000,
    { message: "El período es de hasta un año.", path: ["to"] },
  );
export type ReconciliationQuery = z.infer<typeof ReconciliationQuerySchema>;

const lineId = z.string().uuid();

export const MatchLineSchema = z.object({
  line_id: lineId,
  transaction_ids: z
    .array(z.string().uuid())
    .min(1, "Elegí al menos un movimiento.")
    .max(100, "Hasta 100 movimientos por línea."),
});
export type MatchLineInput = z.infer<typeof MatchLineSchema>;

/** Several lines against one movement (the bank split it): their amounts add
 *  up to the movement's signed amount. */
export const MatchLinesToMovementSchema = z.object({
  line_ids: z
    .array(lineId)
    .min(1, "Elegí al menos una línea.")
    .max(100, "Hasta 100 líneas por movimiento."),
  transaction_id: z.string().uuid(),
});
export type MatchLinesToMovementInput = z.infer<
  typeof MatchLinesToMovementSchema
>;

export const AcceptSuggestionsSchema = z.object({
  matches: z.array(MatchLineSchema).min(1).max(200),
});

export const LineIdSchema = z.object({ line_id: lineId });

export const IgnoreLineSchema = z.object({
  line_id: lineId,
  reason: z
    .string()
    .trim()
    .min(1, "Escribí el motivo.")
    .max(500, "Hasta 500 caracteres."),
});
export type IgnoreLineInput = z.infer<typeof IgnoreLineSchema>;

const optionalId = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const CreateLineTransactionSchema = z.object({
  line_id: lineId,
  channel_id: z.string().min(1, "Elegí el canal.").max(60),
  /** A debit's expense account (required for a debit, none for a credit). */
  expense_account_id: optionalId,
  cost_center_id: optionalId,
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
});
export type CreateLineTransactionInput = z.input<
  typeof CreateLineTransactionSchema
>;

/** A debit line booked as the payment of a tax document
 *  (create_bank_statement_line_tax_payment). Another amount than the
 *  document's needs allow_difference. */
export const CreateLineTaxPaymentSchema = z.object({
  line_id: lineId,
  tax_document_id: z.string().uuid("Elegí el impuesto."),
  allow_difference: z.boolean().optional().default(false),
});
export type CreateLineTaxPaymentInput = z.input<
  typeof CreateLineTaxPaymentSchema
>;

// ─── What the page reads ─────────────────────────────────────────────────────

export type StatementLine = {
  id: string;
  line_date: string;
  description: string;
  /** + credit, - debit. */
  amount: number;
  balance: number | null;
  reference: string | null;
  status: StatementLineStatus;
  ignore_reason: string | null;
  transaction_ids: string[];
};

export type BookMovement = {
  id: string;
  transaction_date: string;
  kind: string;
  /** + income / transfer in, - expense / transfer out. */
  signed_amount: number;
  description: string | null;
  /** The document that owns it (v_transactions_tagged.source_document). */
  source_document: string | null;
  /** The statement lines it is reconciled with: none, one, or several when
   *  the bank split it (each of them matched with this movement alone). */
  line_ids: string[];
};

export type ReconciliationSummary = {
  /** The last balance the statement gives on or before the period's end
   *  (null when the file had no balance column). */
  statement_balance: number | null;
  statement_balance_date: string | null;
  /** Opening balance plus every movement up to the period's end. */
  book_balance: number;
  /** statement_balance - book_balance; null without a statement balance. */
  difference: number | null;
  matched_count: number;
  matched_total: number;
  open_count: number;
  open_total: number;
  ignored_count: number;
  ignored_total: number;
  /** Movements of the period no line explains. */
  unmatched_book_count: number;
  unmatched_book_total: number;
  /** The part of unmatched_book_total dated on or before the statement
   *  balance's date: the part the difference compares (all of it without a
   *  statement balance). */
  unmatched_book_total_at_statement: number;
};

export type MatchSuggestion = {
  line_id: string;
  transaction_id: string;
  /** Days between the line and the movement. */
  days: number;
  /** The line's reference (or a number of its text) is in the movement's. */
  reference_match: boolean;
};

export type ReconciliationAccount = {
  id: string;
  name: string;
  type: string;
  currency: "ARS" | "USD";
};

export type ReconciliationView = {
  account: ReconciliationAccount;
  from: string;
  to: string;
  lines: StatementLine[];
  /** Movements of the account from CANDIDATE_DAY_WINDOW days before the
   *  period to as many after, reconciled or not. */
  movements: BookMovement[];
  suggestions: MatchSuggestion[];
  summary: ReconciliationSummary;
};
