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
