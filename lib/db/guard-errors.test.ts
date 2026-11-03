import { beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: { warn: (...args: unknown[]) => warn(...args), error: vi.fn() },
}));

import { latestDefinition } from "./testing/migration-sql";
import { mapDbGuardError } from "./guard-errors";
import { PG_CHECK_VIOLATION, PG_OBJECT_IN_USE } from "./pg-error-codes";

const ctx = { slug: "receipts.update.rejected", userId: "u-1", id: "r-1" };

describe("mapDbGuardError", () => {
  beforeEach(() => warn.mockClear());

  it("returns the guard's message and warns with ids only", () => {
    const message =
      "El período contable 2026-01 está cerrado y no admite movimientos";
    expect(
      mapDbGuardError(
        { message, code: PG_OBJECT_IN_USE, hint: "jouve_guard" },
        ctx,
      ),
    ).toBe(message);
    expect(warn).toHaveBeenCalledWith("receipts.update.rejected", {
      userId: "u-1",
      id: "r-1",
      code: PG_OBJECT_IN_USE,
    });
  });

  it("returns null for a native CHECK violation", () => {
    expect(
      mapDbGuardError(
        {
          message: 'new row violates check constraint "x"',
          code: PG_CHECK_VIOLATION,
          hint: null,
        },
        ctx,
      ),
    ).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null without an error", () => {
    expect(mapDbGuardError(null, ctx)).toBeNull();
  });
});

// PR D and PR E rewrite some of these guards: whichever version is latest
// must keep the hint on every raise.
const GUARDS = [
  "guard_receipt_allocation",
  "guard_payment_order_allocation",
  "guard_invoice_origin",
  "guard_purchase_invoice_origin",
  "guard_journal_period_closed",
  "guard_transaction_immutable_when_linked",
  "guard_channel_active",
  "guard_invoicing_channel_config",
  "guard_sales_point_channel",
  "create_manual_journal_entry",
  "guard_purchase_invoice_edit",
  "guard_purchase_invoice_open_after_edit",
  "guard_purchase_invoice_fiscal_letter",
  "build_receipt_journal_lines",
  "build_payment_order_journal_lines",
  "journal_entry_status",
  "repost_journal",
  "guard_counterparty_side_immutable",
  "guard_document_side",
  "guard_invoice_source_remito",
  "settle_billed_remito",
  "guard_billed_remito_frozen",
  "guard_invoice_period_closed",
  "guard_issued_check_cancel_live_order",
  "guard_transaction_account_currency",
  "guard_account_currency_change",
  "guard_task_identity",
  "guard_expense_account",
  "guard_transaction_expense_account",
  "guard_loan_installment_paid",
  "pay_loan_installment",
  "adopt_loan_installment_payment",
  "record_loan_disbursement",
  "allocate_receipt",
  "allocate_payment_order",
  "guard_transaction_owned_by_document",
  "fill_payroll_period",
  "seed_sac_period",
  "guard_employee_account_movement",
  "guard_employee_debt_plan",
  "guard_purchase_employee_charge",
  "record_employee_account_cash",
  "delete_employee_account_movement",
  "apply_salary_raise",
  "guard_client_tariff_overlap",
  "guard_freight_settlement",
  "guard_freight_settlement_item",
  "guard_shipment_freight_settlement",
  "save_freight_settlement",
  "confirm_freight_settlement",
  "link_freight_settlement_invoice",
  "cancel_freight_settlement",
  "guard_driver_settlement",
  "guard_driver_settlement_item",
  "guard_driver_settlement_line",
  "guard_shipment_driver_settlement",
  "guard_trip_driver_settlement",
  "save_driver_settlement",
  "confirm_driver_settlement",
  "cancel_driver_settlement",
  "guard_pallet_blocked",
  "guard_late_interest_charge",
  "sell_checks",
  "guard_import_run",
  "guard_historic_row",
  "commit_import_run",
  "undo_import_run",
  "apply_client_opening_balance_core",
  "guard_bank_statement_line",
  "guard_transaction_reconciled",
  "match_bank_statement_line",
  "unmatch_bank_statement_line",
  "set_bank_statement_line_ignored",
  "create_bank_statement_line_transaction",
  "guard_ai_proposal",
];

describe("guard hints in migrations", () => {
  it.each(GUARDS)("every rejection in %s carries hint jouve_guard", (fn) => {
    const raises = [
      ...latestDefinition(fn).matchAll(
        /using\s+errcode\s*=\s*'([^']+)'([^;]*);/gi,
      ),
    ].filter(([, code]) => code !== "42501");
    expect(raises.length).toBeGreaterThan(0);
    for (const [statement, , rest] of raises) {
      expect(rest, statement).toMatch(/hint\s*=\s*'jouve_guard'/);
    }
  });
});
