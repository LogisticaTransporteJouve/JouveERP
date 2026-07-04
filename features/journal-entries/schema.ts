import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

export const JOURNAL_PATH = "/accounting/journal";

export type JournalEntryRow =
  Database["public"]["Tables"]["journal_entries"]["Row"];

export type JournalEntryLineRow =
  Database["public"]["Tables"]["journal_entry_lines"]["Row"];

export type JournalSourceTable =
  | "transactions"
  | "invoices"
  | "receipts"
  | "payment_orders";

export const SOURCE_LABEL: Record<JournalSourceTable, string> = {
  transactions: "Movimiento de caja",
  invoices: "Comprobante emitido",
  receipts: "Recibo",
  payment_orders: "Orden de pago",
};

export const SOURCE_HREF_PREFIX: Record<JournalSourceTable, string> = {
  transactions: "/transactions",
  invoices: "/invoices",
  receipts: "/receipts",
  payment_orders: "/payment-orders",
};

export function isKnownSource(s: string | null): s is JournalSourceTable {
  return (
    s === "transactions" ||
    s === "invoices" ||
    s === "receipts" ||
    s === "payment_orders"
  );
}

export type JournalEntryWithLines = JournalEntryRow & {
  lines: Array<
    JournalEntryLineRow & {
      account: {
        id: string;
        code: string;
        name: string;
      };
    }
  >;
  channel: {
    id: string;
    name: string;
  } | null;
};

export type JournalFilters = {
  /** YYYY-MM o null para todos */
  period?: string | null;
  sourceTable?: JournalSourceTable | "all" | null;
  channelId?: string | null;
};

export function isPeriodFormat(s: string): boolean {
  return /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Manual entries (source_table null) — ajustes, previsiones, RG 4667, etc.
// ---------------------------------------------------------------------------

const lineAmount = z
  .number({ message: "Importe inválido." })
  .min(0, "El importe no puede ser negativo.")
  .finite("Importe inválido.")
  .max(1_000_000_000_000);

export const ManualJournalLineSchema = z
  .object({
    account_id: z.string().uuid("Cuenta requerida."),
    debit: lineAmount,
    credit: lineAmount,
    description: z
      .string()
      .trim()
      .max(300)
      .transform((v) => (v.length === 0 ? null : v))
      .nullable()
      .optional(),
  })
  .refine((l) => (l.debit > 0) !== (l.credit > 0), {
    message: "Cada línea lleva importe en Debe o en Haber (solo uno).",
  });

export const ManualJournalEntryCreateSchema = z
  .object({
    entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
    description: z.string().trim().min(1, "Descripción requerida.").max(500),
    channel_id: z.string().trim().min(1).nullable().optional(),
    lines: z
      .array(ManualJournalLineSchema)
      .min(2, "Un asiento necesita al menos dos líneas."),
  })
  .superRefine((value, ctx) => {
    const cents = (n: number) => Math.round(n * 100);
    const debe = value.lines.reduce((a, l) => a + l.debit, 0);
    const haber = value.lines.reduce((a, l) => a + l.credit, 0);
    if (cents(debe) !== cents(haber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lines"],
        message: `El asiento no balancea: Debe ${debe.toFixed(2)} ≠ Haber ${haber.toFixed(2)}.`,
      });
    } else if (cents(debe) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lines"],
        message: "El asiento no puede ser por cero.",
      });
    }
  });

export type ManualJournalLineInput = z.infer<typeof ManualJournalLineSchema>;
export type ManualJournalEntryCreateInput = z.infer<
  typeof ManualJournalEntryCreateSchema
>;

/** Accrual period (YYYY-MM) implied by an entry date (YYYY-MM-DD). */
export function accrualPeriodFromDate(date: string): string {
  return date.slice(0, 7);
}
