import { describe, expect, it } from "vitest";

import {
  SUPPLIER_MOVEMENT_KIND_LABEL,
  formatSupplierMovementNumber,
} from "./account-movement-format";

describe("supplier statement rows", () => {
  it("a bounced check reads as such, with the number of its OP", () => {
    const row = {
      source_type: "rejected_check" as const,
      kind: "rejected_check",
      letter: null,
      punto_venta: 3,
      numero: 41,
    };
    expect(SUPPLIER_MOVEMENT_KIND_LABEL[row.kind]).toBe("Cheque rechazado");
    expect(formatSupplierMovementNumber(row)).toBe("OP00003-00000041");
  });
});
