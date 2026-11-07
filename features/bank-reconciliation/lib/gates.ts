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
  };
}
