import { beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.fn();
const error = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    warn: (...args: unknown[]) => warn(...args),
    error: (...args: unknown[]) => error(...args),
  },
}));

import { latestDefinition } from "./testing/migration-sql";
import { dbErrorMessage, mapDbGuardError } from "./guard-errors";
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

describe("dbErrorMessage", () => {
  beforeEach(() => {
    warn.mockClear();
    error.mockClear();
  });

  it("shows a guard's message", () => {
    const message = "Período cerrado: no se pueden modificar entries";
    expect(
      dbErrorMessage(
        { message, code: PG_CHECK_VIOLATION, hint: "jouve_guard" },
        ctx,
        "No se pudo guardar.",
      ),
    ).toBe(message);
    expect(error).not.toHaveBeenCalled();
  });

  it("logs any other error and shows the fallback instead of its text", () => {
    const raw = {
      message: "payment_lines sum (10) does not match total_amount (12)",
      code: "P0001",
      hint: null,
    };
    expect(dbErrorMessage(raw, ctx, "No se pudo guardar.")).toBe(
      "No se pudo guardar.",
    );
    expect(error).toHaveBeenCalledWith("receipts.update.rejected", {
      userId: "u-1",
      id: "r-1",
      error: raw,
    });
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
  "guard_purchase_invoice_total",
  "guard_purchase_invoice_items_period",
  "replace_purchase_invoice_items",
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
  "guard_automatic_task_close",
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
  "create_sac_period",
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
  "confirm_freight_settlement_document",
  "reprice_freight_settlement",
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
  "guard_employee_account_movement",
  "delete_employee_account_movement",
  "post_driver_settlement_difference",
  "unpost_driver_settlement_difference",
  "guard_pallet_blocked",
  "guard_late_interest_charge",
  "sell_checks",
  "guard_check_sale",
  "cancel_check_sale",
  "reject_sold_check_as_debt",
  "pay_check_sale_debt",
  "unblock_pallet",
  "guard_storage_tariff_migrated",
  "guard_import_run",
  "guard_historic_row",
  "commit_import_run",
  "undo_import_run",
  "apply_client_opening_balance_core",
  "apply_supplier_opening_balance",
  "guard_bank_statement_line",
  "guard_transaction_reconciled",
  "match_bank_statement_line",
  "unmatch_bank_statement_line",
  "set_bank_statement_line_ignored",
  "create_bank_statement_line_transaction",
  "guard_ai_proposal",
  "guard_tax_document",
  "pay_tax_document",
  "link_tax_document_payment",
  "create_bank_statement_line_tax_payment",
  "guard_bank_statement_match",
  "match_bank_statement_lines",
  "recategorize_expense",
  "purchase_nc_nd_follow_factura",
  "undo_tax_document_payment",
  "get_vehicle_margin",
  "guard_driver_settlement_difference_receipt",
  "remove_driver_settlement_difference",
  "guard_payment_order_cancel_cashed_check",
  "update_payment_order",
  "guard_loan",
  "guard_issued_check_edit",
  "guard_check_edit",
  "guard_check_movement",
  "create_transfer",
  "reject_check",
  "guard_payment_order_rejected_check_allocation",
  "guard_invoice_cotizacion",
  "issued_check_rejected_inflow",
  "guard_document_header",
  "guard_document_line",
  "deposit_check",
  "guard_supplier_cuit_closed_period",
  "guard_document_insert",
  "guard_loan_installment_payment",
  "create_loan_core",
  "guard_payment_order_line_cartera",
  "create_receipt",
  "update_receipt",
  "guard_transaction_origin",
  "guard_payroll_payment_transaction",
  "claim_storage_billing_period_with_relinks",
  "guard_storage_billing_run_invoice",
  "guard_storage_billing_run_delete",
  "enforce_payroll_period_immutability",
  "guard_shipment_invoice",
  "guard_billed_shipment",
  "guard_check_import_run",
  "guard_link_file_visible",
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
