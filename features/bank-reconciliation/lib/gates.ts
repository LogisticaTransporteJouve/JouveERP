import { CHECK_CASH_PERMISSIONS } from "@/features/checks/lib/check-cash";
import { IMPORT_KIND_PERMISSION } from "@/features/imports/schema";
import { ISSUED_CHECK_CASH_PERMISSIONS } from "@/features/issued-checks/lib/issued-check-cash";
import { LOAN_CASH_PERMISSIONS } from "@/features/loans/lib/loan-cash";
import {
  TREASURY_WRITE_PERMISSIONS,
  userCan,
  userCanAll,
  type Access,
} from "@/lib/auth/permissions";

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
  /** Makes a payment order from a payment debit (payment_orders:write +
   *  accounts:read). */
  canPay: boolean;
  canEditRetentions: boolean;
  /** Creates a chart account from the bank codes (accounting:write). */
  canManageChart: boolean;
  /** Pays a loan cuota from a debit line (accounting:write +
   *  transactions:write). */
  canPayLoans: boolean;
  /** Books a transfer between own accounts or pays a card statement from a
   *  line (treasury reads + transactions:write). */
  canTreasuryWrite: boolean;
  /** Deposits a cartera cheque from a credit line (+ cheques:write). */
  canDepositChecks: boolean;
  /** Marks an own cheque cashed from its debit (issued cheques' cash
   *  permissions + transactions:write). */
  canDebitIssuedChecks: boolean;
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
    canPay:
      userCan(access, "payment_orders:write") &&
      userCan(access, "accounts:read"),
    canEditRetentions: userCan(access, "retentions:write"),
    canManageChart:
      userCan(access, "accounting:write") && userCan(access, "accounting:read"),
    canPayLoans: userCanAll(access, LOAN_CASH_PERMISSIONS),
    canTreasuryWrite: userCanAll(access, TREASURY_WRITE_PERMISSIONS),
    canDepositChecks:
      userCanAll(access, TREASURY_WRITE_PERMISSIONS) &&
      userCanAll(access, CHECK_CASH_PERMISSIONS),
    canDebitIssuedChecks:
      canWrite && userCanAll(access, ISSUED_CHECK_CASH_PERMISSIONS),
  };
}
