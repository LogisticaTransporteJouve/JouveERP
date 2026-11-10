import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = ["finance"];
let denied: string[] = [];
const rpc = vi.fn();
const updates: Record<string, unknown>[] = [];
let line: Record<string, unknown> | null;
let check: Record<string, unknown> | null;
let cashedRows: { id: string }[];
let txRows: { id: string }[];

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    rpc,
    from: (table: string) => {
      let isUpdate = false;
      const q = {
        select: () => q,
        eq: () => q,
        update: (v: Record<string, unknown>) => {
          isUpdate = true;
          updates.push(v);
          return q;
        },
        maybeSingle: async () => ({
          data: table === "bank_statement_lines" ? line : check,
          error: null,
        }),
        then: (resolve: (v: unknown) => void) =>
          resolve({
            data: isUpdate ? cashedRows : txRows,
            error: null,
          }),
      };
      return q;
    },
  }),
}));

const { debitIssuedCheckFromLineAction } =
  await import("./reconciliation-actions");

const LINE = "00000000-0000-4000-8000-000000000001";
const CHECK = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  roles = ["finance"];
  denied = [];
  rpc.mockReset();
  updates.length = 0;
  line = {
    account_id: "galicia",
    line_date: "2026-11-05",
    amount: -1500000,
    status: "open",
  };
  check = {
    amount: 1500000,
    check_number: "00000577",
    bank_account_id: "galicia",
    status: "emitted",
    currency: "ARS",
  };
  cashedRows = [{ id: CHECK }];
  txRows = [{ id: "tx1" }];
});

const input = { line_id: LINE, issued_check_id: CHECK };

describe("debitIssuedCheckFromLineAction", () => {
  it("cashes the cheque on the line's date and reconciles the line", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await debitIssuedCheckFromLineAction(input);
    expect(res).toEqual({ ok: true, data: { line_id: LINE } });
    expect(updates).toEqual([{ status: "cashed", cashed_at: "2026-11-05" }]);
    expect(rpc).toHaveBeenCalledWith(
      "match_bank_statement_line",
      expect.objectContaining({ p_line_id: LINE, p_transaction_ids: ["tx1"] }),
    );
  });

  it("refuses a cheque of another amount without touching it", async () => {
    check = { ...check, amount: 1400000 };
    const res = await debitIssuedCheckFromLineAction(input);
    expect(res).toEqual({
      ok: false,
      error: "El cheque no es del importe de la línea.",
    });
    expect(updates).toEqual([]);
  });

  it("refuses a cheque already cashed", async () => {
    check = { ...check, status: "cashed" };
    const res = await debitIssuedCheckFromLineAction(input);
    expect(res.ok).toBe(false);
    expect(updates).toEqual([]);
  });

  it("needs the issued cheques' cash permissions", async () => {
    denied = ["issued_checks:write"];
    const res = await debitIssuedCheckFromLineAction(input);
    expect(res.ok).toBe(false);
    expect(updates).toEqual([]);
  });
});
