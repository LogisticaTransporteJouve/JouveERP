import { PeriodSchema } from "@/lib/validation/common";

export const MonthlyPackagePeriodSchema = PeriodSchema;

/** A count the checklist shows; null when it could not be read (shown as
 *  such, never as zero). */
export type CheckCount = number | null;

/** The state of a month before handing it to the accountant. Every count is
 *  over the fiscal channels: what the books and AFIP see. */
export type MonthlyPackageStatus = {
  period: string;
  /** When the period was closed; null while it is open or unread. */
  closedAt: string | null;
  /** The closing could not be read: neither open nor closed is shown. */
  closedReadFailed: boolean;
  /** Authorized documents of the period still waiting for their entry. */
  pendingJournal: CheckCount;
  /** Documents of any period with no or a stale entry
   *  (journal_missing_entries). */
  missingJournal: CheckCount;
  /** Fiscal comprobantes dated in the period that are not authorized. */
  invoicesDraft: CheckCount;
  invoicesEmitting: CheckCount;
  invoicesFailed: CheckCount;
  /** CAEA comprobantes of the period not yet informed to AFIP. */
  caeaUninformed: CheckCount;
  /** Fiscal purchases of the period without a letter (A/B/C). */
  purchasesWithoutLetter: CheckCount;
};

/** Whether the item needs attention: a count above zero or an unread one. */
export function needsAttention(count: CheckCount): boolean {
  return count === null || count > 0;
}
