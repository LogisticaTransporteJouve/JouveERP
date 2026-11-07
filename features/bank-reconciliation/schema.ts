import { z } from "zod";

import type { IvaCondition } from "@/features/clients/schema";

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

export const MatchLineToReceiptSchema = z.object({
  line_id: lineId,
  receipt_id: z.string().uuid(),
});
export type MatchLineToReceiptInput = z.infer<typeof MatchLineToReceiptSchema>;

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
  /** The bank's code for the movement (Macro: "Código Causal"). */
  bank_code: string | null;
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

// ─── Bank codes ──────────────────────────────────────────────────────────────

/** What a bank code is: a tax or a bank fee posts to its chart account; the
 *  rest point to the document that books it. */
export const BANK_CODE_KINDS = [
  "tax",
  "bank_fee",
  "receipt",
  "payment",
  "transfer",
  "loan",
  "ignore",
  "check_sale",
  "card_payment",
  "check_deposit",
] as const;
export type BankCodeKind = (typeof BANK_CODE_KINDS)[number];

export const BANK_CODE_KIND_LABEL: Record<BankCodeKind, string> = {
  tax: "Impuesto",
  bank_fee: "Gasto bancario",
  receipt: "Cobro de cliente",
  payment: "Pago a proveedor",
  transfer: "Transferencia entre cuentas",
  loan: "Cuota de préstamo",
  ignore: "No corresponde",
  check_sale: "Descuento de cheques",
  card_payment: "Pago de tarjeta",
  check_deposit: "Depósito de cheque",
};

export function isBankCodeKind(value: unknown): value is BankCodeKind {
  return (
    typeof value === "string" &&
    (BANK_CODE_KINDS as readonly string[]).includes(value)
  );
}

/** The tax credits a bank debits (is_bank_tax_account in SQL): a line may
 *  post to them, with taxes:write. */
export const BANK_TAX_ROLES = [
  "percepciones_iibb_pagadas",
  "retenciones_pagadas",
  "percepciones_ganancias",
  "iva_credito",
  "percepciones_iva_pagadas",
] as const;

/** A tax or a bank fee is booked straight to its chart account. */
export function bankCodePosts(kind: BankCodeKind): boolean {
  return kind === "tax" || kind === "bank_fee";
}

export type BankStatementCode = {
  id: string;
  account_id: string;
  bank_code: string;
  /** Text the description contains; "" = the whole code. */
  description_pattern: string;
  kind: BankCodeKind;
  chart_account_id: string | null;
  /** "5.4.3 Impuesto a los débitos y créditos bancarios". */
  chart_account_label: string | null;
  label: string | null;
};

/** A chart account a tax or a fee can post to. */
export type PostingAccount = {
  id: string;
  code: string;
  name: string;
  /** expense: a postable expense leaf; tax: a tax credit the bank debits. */
  group: "expense" | "tax";
};

export const SaveBankStatementCodeSchema = z
  .object({
    id: z.string().uuid().nullable().optional(),
    account_id: z.string().uuid(),
    /** Empty for a bank with no code: the text below then says what it is. */
    bank_code: z.string().trim().max(20).default(""),
    description_pattern: z.string().trim().max(80).default(""),
    kind: z.enum(BANK_CODE_KINDS),
    chart_account_id: z.string().uuid().nullable().optional(),
    label: z
      .string()
      .trim()
      .max(120)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.bank_code === "" && v.description_pattern === "") {
      ctx.addIssue({
        code: "custom",
        path: ["bank_code"],
        message: "Cargá el código del banco o el texto del concepto.",
      });
    }
    if (!bankCodePosts(v.kind) && v.chart_account_id) {
      ctx.addIssue({
        code: "custom",
        path: ["chart_account_id"],
        message: "Solo un impuesto o un gasto bancario lleva cuenta contable.",
      });
    }
  });
export type SaveBankStatementCodeInput = z.input<
  typeof SaveBankStatementCodeSchema
>;

export const DeleteBankStatementCodeSchema = z.object({
  id: z.string().uuid(),
});

export const BANK_CODE_PRESETS = ["macro", "provincia", "galicia"] as const;
export const BANK_CODE_PRESET_LABEL: Record<
  (typeof BANK_CODE_PRESETS)[number],
  string
> = {
  macro: "Banco Macro",
  provincia: "Banco Provincia",
  galicia: "Banco Galicia",
};
export type BankCodePreset = (typeof BANK_CODE_PRESETS)[number];

export const PresetBankStatementCodesSchema = z.object({
  account_id: z.string().uuid(),
  preset: z.enum(BANK_CODE_PRESETS),
});

export const StatementCodingInputSchema = z.object({
  account_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** A client found by a CUIT in a line, as the receipt form takes it. */
export type StatementClient = {
  id: string;
  cuit: string;
  legal_name: string;
  display_name: string | null;
  iva_condition: IvaCondition | null;
  is_fiscal: boolean;
};

/** What the page needs to propose each line: the account's codes, the
 *  accounts a code can post to, and the clients whose CUIT is in a line. */
/** A pending cuota of a loan debited from the statement's account. */
export type StatementLoanInstallment = {
  id: string;
  loan_description: string;
  number: number;
  count: number;
  due_date: string;
  amount: number;
  /** The plan's capital (the whole cuota when it has no split). */
  capital: number;
  iva: number;
  /** The taxes the bank charged on the interest of the account's last
   *  cuota that had them (Banco Provincia: «Impuestos» / «Intereses»);
   *  null when none did. Used to suggest the split of the next debit. */
  tax_rate?: number | null;
};

export type StatementCoding = {
  codes: BankStatementCode[];
  posting_accounts: PostingAccount[];
  clients: StatementClient[];
  /** clients:read; without it no client is looked up. */
  can_read_clients: boolean;
  /** Pending cuotas of the loans debited from this account (empty without
   *  permission to see loans). */
  loan_installments: StatementLoanInstallment[];
  /** The company's own CUIT: a transfer carrying it is between its own
   *  accounts, not a collection. */
  company_cuit: string | null;
  /** The cheques sold to a bank (sell_checks) whose transfer to this account
   *  no line explains yet: a discount credit is reconciled with them. */
  check_sale_transfers?: StatementCheckSaleTransfer[];
  card_statements?: StatementCardStatement[];
  cartera_checks?: StatementCarteraCheck[];
};

/** A line that moves money to or from another account of the company:
 *  the transfer is created and both statement lines reconciled. */
export const TransferFromLineSchema = z.object({
  line_id: z.string().uuid(),
  other_account_id: z.string().uuid("Elegí la otra cuenta."),
});
export type TransferFromLineInput = z.infer<typeof TransferFromLineSchema>;

export const PayCardFromLineSchema = z.object({
  line_id: z.string().uuid(),
  statement_id: z.string().uuid(),
  currency: z.enum(["ARS", "USD"]),
});
export type PayCardFromLineInput = z.infer<typeof PayCardFromLineSchema>;

/** A card statement paid from this account with a part (pesos or dollars)
 *  not paid yet: the bank's debit of the payment pays it. */
export type StatementCardStatement = {
  id: string;
  label: string;
  due_date: string;
  total_ars: number;
  total_usd: number;
  ars_pending: boolean;
  usd_pending: boolean;
};

/** A cheque in a cartera: a deposit credit of its amount takes it to the bank. */
export type StatementCarteraCheck = {
  id: string;
  check_number: string;
  amount: number;
  due_date: string;
  drawer_name: string;
};

export const DepositCheckFromLineSchema = z.object({
  line_id: z.string().uuid(),
  check_id: z.string().uuid(),
});
export type DepositCheckFromLineInput = z.infer<
  typeof DepositCheckFromLineSchema
>;

export type StatementCheckSaleTransfer = {
  id: string;
  sale_id: string;
  date: string;
  amount: number;
  description: string;
};

const splitPart = z.number().min(0).max(1e12);

export const PayLoanFromLineSchema = z.object({
  line_id: z.string().uuid(),
  installment_id: z.string().uuid(),
  /** What the bank applied when the debit is not the plan's amount (interest
   *  by days, punitorios, taxes): it must add up to the debit. */
  split: z
    .object({
      capital: splitPart,
      interest: splitPart,
      late_interest: splitPart,
      iva: splitPart,
      taxes: splitPart,
    })
    .nullable()
    .optional(),
});
export type PayLoanFromLineInput = z.infer<typeof PayLoanFromLineSchema>;
