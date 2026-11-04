import { describe, expect, it } from "vitest";

import { ACCOUNTS_UNAVAILABLE_MESSAGE } from "@/features/accounts/lib/accounts-unavailable";
import { CHECK_CASH_DENIED_REASON } from "@/features/checks/lib/check-cash";
import { resolveAccess } from "@/lib/auth/permissions";

import { reviewCreateDeniedReason } from "./review-gates";

const KINDS = [
  "check",
  "receipt",
  "payment_order",
  "sales_invoice",
  "purchase_invoice",
  "credit_debit_note",
];

describe("reviewCreateDeniedReason", () => {
  it.each(KINDS)("finance can create from a scanned %s", (kind) => {
    expect(
      reviewCreateDeniedReason(resolveAccess(["finance"]), kind),
    ).toBeNull();
  });

  it.each([
    ["check", "No tenés permiso para cargar cheques."],
    ["receipt", "No tenés permiso para cargar recibos."],
    ["payment_order", "No tenés permiso para cargar órdenes de pago."],
    ["sales_invoice", "No tenés permiso para emitir facturas."],
    ["purchase_invoice", "No tenés permiso para cargar compras."],
    ["credit_debit_note", "No tenés permiso para cargar compras."],
  ])("operations (Documentos, no finance writes) cannot: %s", (kind, why) => {
    expect(reviewCreateDeniedReason(resolveAccess(["operations"]), kind)).toBe(
      why,
    );
  });

  it.each(["check", "receipt", "payment_order"])(
    "a %s picks an account: refused without accounts:read",
    (kind) => {
      const access = resolveAccess(["finance"], ["accounts:read"]);
      expect(reviewCreateDeniedReason(access, kind)).toBe(
        ACCOUNTS_UNAVAILABLE_MESSAGE,
      );
    },
  );

  it("a check moves money: refused without transactions:write", () => {
    const access = resolveAccess(["finance"], ["transactions:write"]);
    expect(reviewCreateDeniedReason(access, "check")).toBe(
      CHECK_CASH_DENIED_REASON,
    );
  });

  it.each(["bank_statement", "delivery_note", null])(
    "%s has no create action to gate",
    (kind) => {
      expect(
        reviewCreateDeniedReason(resolveAccess(["operations"]), kind),
      ).toBeNull();
    },
  );
});
