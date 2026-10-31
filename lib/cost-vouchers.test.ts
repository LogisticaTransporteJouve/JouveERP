import { describe, expect, it } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import {
  costVoucherAccess,
  costVoucherDenied,
  costVoucherPatch,
} from "./cost-vouchers";

const ID = "00000000-0000-0000-0000-000000000001";

describe("cost vouchers", () => {
  it("operations sees neither source and cannot set a link", () => {
    const ops = resolveAccess(["operations"]);
    expect(costVoucherAccess(ops)).toEqual({
      purchaseInvoices: false,
      transactions: false,
    });
    expect(costVoucherDenied(ops, { purchase_invoice_id: ID })).toMatch(
      /facturas de compra/,
    );
    expect(costVoucherDenied(ops, { transaction_id: null })).toMatch(
      /movimientos/,
    );
    expect(costVoucherDenied(ops, {})).toBeNull();
  });

  it("finance can link both; a deny on transactions:read blocks that link", () => {
    expect(
      costVoucherDenied(resolveAccess(["finance"]), {
        purchase_invoice_id: ID,
        transaction_id: ID,
      }),
    ).toBeNull();
    const denied = resolveAccess(["finance"], ["transactions:read"]);
    expect(costVoucherDenied(denied, { transaction_id: ID })).toMatch(
      /movimientos/,
    );
  });

  it("the patch leaves out what the input does not set", () => {
    expect(costVoucherPatch({})).toEqual({});
    expect(costVoucherPatch({ purchase_invoice_id: null })).toEqual({
      purchase_invoice_id: null,
    });
  });
});
