import { z } from "zod";

export const CARD_TREATMENTS = ["expense", "advance", "ignore"] as const;
export type CardTreatment = (typeof CARD_TREATMENTS)[number];

export const CARD_TREATMENT_LABEL: Record<CardTreatment, string> = {
  expense: "Gasto de la empresa",
  advance: "Adelanto de sueldo",
  ignore: "No corresponde",
};

export const CARD_STATUS_LABEL = {
  pendiente: "Pendiente",
  pagado: "Pagado",
} as const;
export type CardStatementStatus = keyof typeof CARD_STATUS_LABEL;

export function isCardTreatment(v: unknown): v is CardTreatment {
  return (
    typeof v === "string" && (CARD_TREATMENTS as readonly string[]).includes(v)
  );
}
export function isCardStatementStatus(v: unknown): v is CardStatementStatus {
  return v === "pendiente" || v === "pagado";
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().finite().min(-1e12).max(1e12);

/** A statement as the PDF reader returns it, plus the account that pays it. */
export const CreateCardStatementSchema = z.object({
  pay_account_id: z.string().uuid("Elegí la cuenta que paga la tarjeta."),
  statement: z.object({
    number: z.string().trim().min(1).max(60),
    account_number: z.string().trim().min(1).max(40).nullable(),
    close_date: isoDate,
    due_date: isoDate,
    total_ars: money.min(0),
    total_usd: money.min(0),
    cards: z
      .array(
        z.object({
          last4: z.string().regex(/^\d{4}$/),
          holder: z.string().trim().min(1).max(120),
          purchases: z
            .array(
              z.object({
                date: isoDate,
                description: z.string().trim().min(1).max(200),
                installment: z.string().max(10).nullable(),
                amount: money,
                currency: z.enum(["ARS", "USD"]),
              }),
            )
            .max(2000),
        }),
      )
      .min(1)
      .max(50),
    charges: z
      .array(
        z.object({
          date: isoDate,
          description: z.string().trim().min(1).max(200),
          kind: z.string().max(40),
          amount: money,
        }),
      )
      .max(200),
  }),
});
export type CreateCardStatementInput = z.input<
  typeof CreateCardStatementSchema
>;

const treatmentFields = {
  treatment: z.enum(CARD_TREATMENTS),
  chart_account_id: z.string().uuid().nullable(),
  employee_id: z.string().uuid().nullable(),
};

function treatmentComplete(v: {
  treatment: CardTreatment;
  chart_account_id: string | null;
  employee_id: string | null;
}) {
  return v.treatment !== "advance" || v.employee_id !== null;
}

export const SetCardLinesSchema = z
  .object({
    statement_id: z.string().uuid(),
    line_ids: z.array(z.string().uuid()).min(1).max(2000),
    ...treatmentFields,
  })
  .refine(treatmentComplete, { message: "Elegí el empleado del adelanto." });
export type SetCardLinesInput = z.infer<typeof SetCardLinesSchema>;

/** A card's default, applied to its lines of the statement not paid yet. */
export const SetCardHolderSchema = z
  .object({
    statement_id: z.string().uuid(),
    last4: z.string().regex(/^\d{4}$/),
    ...treatmentFields,
  })
  .refine(treatmentComplete, { message: "Elegí el empleado del adelanto." });
export type SetCardHolderInput = z.infer<typeof SetCardHolderSchema>;

export const DeleteCardStatementSchema = z.object({ id: z.string().uuid() });

export const UnsettleCardStatementSchema = z.object({
  id: z.string().uuid(),
  currency: z.enum(["ARS", "USD"]),
});
export type UnsettleCardStatementInput = z.infer<
  typeof UnsettleCardStatementSchema
>;

const cents = (n: number) => Math.round(n * 100);

/** The statement adds up: its purchases and charges in pesos are its total
 *  in pesos, its purchases in dollars its total in dollars. Paying it books
 *  exactly its lines, so a gap would be booked nowhere (or inside one line). */
export function statementAddsUp(
  s: CreateCardStatementInput["statement"],
): boolean {
  const purchases = s.cards.flatMap((c) => c.purchases);
  const ars =
    purchases
      .filter((p) => p.currency === "ARS")
      .reduce((t, p) => t + cents(p.amount), 0) +
    s.charges.reduce((t, c) => t + cents(c.amount), 0);
  const usd = purchases
    .filter((p) => p.currency === "USD")
    .reduce((t, p) => t + cents(p.amount), 0);
  return ars === cents(s.total_ars) && usd === cents(s.total_usd);
}

export type CardStatementListItem = {
  id: string;
  number: string;
  brand: string;
  account_number: string;
  pay_account_name: string;
  close_date: string;
  due_date: string;
  total_ars: number;
  total_usd: number;
  status: CardStatementStatus;
  paid_ars_on: string | null;
  paid_usd_on: string | null;
};

export type CardStatementLine = {
  id: string;
  source: "purchase" | "charge";
  card_last4: string | null;
  line_date: string;
  description: string;
  installment: string | null;
  currency: "ARS" | "USD";
  amount: number;
  treatment: CardTreatment;
  chart_account_id: string | null;
  employee_id: string | null;
  paid: boolean;
};

export type CardHolder = {
  last4: string;
  holder: string;
  treatment: CardTreatment;
  chart_account_id: string | null;
  employee_id: string | null;
};

export type CardStatementDetail = {
  statement: CardStatementListItem;
  lines: CardStatementLine[];
  holders: CardHolder[];
  accounts: { id: string; code: string; name: string }[];
  employees: { id: string; name: string }[];
};
