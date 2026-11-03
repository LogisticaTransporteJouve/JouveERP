import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

type Row = Record<string, unknown>;

const PO = "00000000-0000-4000-8000-000000000001";
let unapplied: Row | null = null;
let rejected: Row[] = [];
const rpc = vi.fn();

function builder(table: string) {
  let from = 0;
  const b = {
    select: () => b,
    eq: () => b,
    gt: () => b,
    order: () => b,
    range: (start: number) => {
      from = start;
      return b;
    },
    maybeSingle: async () => ({ data: unapplied, error: null }),
    then<T>(resolve: (v: { data: Row[]; error: null }) => T): T {
      return resolve({
        data:
          table === "v_supplier_rejected_check_open" && from === 0
            ? rejected
            : [],
        error: null,
      });
    },
  };
  return b;
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"], []),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: builder, rpc }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { allocatePaymentOrderAction } = await import("./payment-orders-actions");

beforeEach(() => {
  unapplied = {
    payment_order_id: PO,
    supplier_id: "s1",
    channel_id: "jouve_internal",
    currency: "ARS",
    unapplied_amount: 60,
  };
  rejected = [
    {
      check_kind: "issued",
      check_id: "c-old",
      check_number: "1",
      rejected_on: "2026-09-01",
      open_amount: 40,
      currency: "ARS",
    },
    {
      check_kind: "endorsed",
      check_id: "c-new",
      check_number: "2",
      rejected_on: "2026-10-01",
      open_amount: 100,
      currency: "ARS",
    },
    {
      check_kind: "endorsed",
      check_id: "c-usd",
      check_number: "3",
      rejected_on: "2026-08-01",
      open_amount: 5,
      currency: "USD",
    },
  ];
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
});

describe("allocatePaymentOrderAction, rejected checks", () => {
  it("applies the a cuenta to the bounced checks of its currency, oldest first", async () => {
    const res = await allocatePaymentOrderAction({
      payment_order_id: PO,
      mode: "rejected_checks",
    });
    expect(res).toEqual({ ok: true, data: { applied: 60 } });
    expect(rpc).toHaveBeenCalledWith("allocate_payment_order", {
      p_payment_order_id: PO,
      p_allocations: [
        { check_kind: "issued", check_id: "c-old", amount_applied: 40 },
        { check_kind: "endorsed", check_id: "c-new", amount_applied: 20 },
      ],
    });
  });

  it("refuses when the supplier has no bounced check in that currency", async () => {
    rejected = rejected.filter((c) => c.currency === "USD");
    const res = await allocatePaymentOrderAction({
      payment_order_id: PO,
      mode: "rejected_checks",
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
