import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
let denied: string[] = [];
const rpc = vi.fn();
const audit = vi.fn();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => audit(...args),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc }),
}));

const { createLineTaxPaymentAction } = await import("./reconciliation-actions");

const LINE = "00000000-0000-4000-8000-000000000001";
const DOC = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  roles = ["finance"];
  denied = [];
  rpc.mockReset();
  audit.mockReset();
});

describe("createLineTaxPaymentAction", () => {
  it("pays and reconciles through one RPC, auditing both writes", async () => {
    rpc.mockResolvedValue({ data: "tx1", error: null });
    const res = await createLineTaxPaymentAction({
      line_id: LINE,
      tax_document_id: DOC,
      allow_difference: true,
    });
    expect(res).toEqual({ ok: true, data: { transaction_id: "tx1" } });
    expect(rpc).toHaveBeenCalledWith("create_bank_statement_line_tax_payment", {
      p_line_id: LINE,
      p_tax_document_id: DOC,
      p_user_id: "u1",
      p_allow_difference: true,
    });
    expect(audit.mock.calls.map((c) => [c[0], c[3]])).toEqual([
      ["tax_document.paid", DOC],
      ["bank_statement_line.matched", LINE],
    ]);
  });

  it("needs taxes:write as well as transactions:write", async () => {
    denied = ["taxes:write"];
    const res = await createLineTaxPaymentAction({
      line_id: LINE,
      tax_document_id: DOC,
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows a guard's own message and audits nothing", async () => {
    const message =
      "Solo un débito del extracto puede ser el pago de un impuesto";
    rpc.mockResolvedValue({
      data: null,
      error: { message, code: "22023", hint: "jouve_guard" },
    });
    const res = await createLineTaxPaymentAction({
      line_id: LINE,
      tax_document_id: DOC,
    });
    expect(res).toEqual({ ok: false, error: message });
    expect(audit).not.toHaveBeenCalled();
  });
});
