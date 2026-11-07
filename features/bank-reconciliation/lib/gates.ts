import { IMPORT_KIND_PERMISSION } from "@/features/imports/schema";
import { userCan, userCanAll, type Access } from "@/lib/auth/permissions";

/** What a user may do on a statement, for every page that shows one. */
export type ReconciliationGates = {
  /** transactions:write: match, unmatch, ignore, create. */
  canWrite: boolean;
  /** taxes:write too: a debit line can be booked as a tax payment. */
  canPayTaxes: boolean;
  /** May import statements (imports:write + transactions:write). */
  canImport: boolean;
  /** accounts:read, which the import dialog needs to show the account. */
  canReadAccounts: boolean;
  /** Makes a receipt from a collection line (receipts:write + accounts:read). */
  canCollect: boolean;
  canEditRetentions: boolean;
  /** Creates a chart account from the bank codes (accounting:write). */
  canManageChart: boolean;
};

export function reconciliationGates(access: Access): ReconciliationGates {
  const canWrite = userCan(access, "transactions:write");
  return {
    canWrite,
    canPayTaxes: canWrite && userCan(access, "taxes:write"),
    canImport:
      userCan(access, "imports:write") &&
      userCanAll(access, IMPORT_KIND_PERMISSION.bank_statement),
    canReadAccounts: userCan(access, "accounts:read"),
    canCollect:
      userCan(access, "receipts:write") && userCan(access, "accounts:read"),
    canEditRetentions: userCan(access, "retentions:write"),
    canManageChart:
      userCan(access, "accounting:write") && userCan(access, "accounting:read"),
  };
}
