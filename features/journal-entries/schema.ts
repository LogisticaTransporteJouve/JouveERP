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
