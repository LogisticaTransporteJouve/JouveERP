import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const logAudit = vi.fn();
const loadChannelPos = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock("@/lib/channel-pos", () => ({ loadChannelPos }));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const { createPaymentOrder } = await import("./create-payment-order");

const SUPPLIER = "00000000-0000-4000-8000-000000000001";
const ACCOUNT = "00000000-0000-4000-8000-000000000002";
const ARS_FC = "00000000-0000-4000-8000-000000000003";
const USD_FC = "00000000-0000-4000-8000-000000000004";

const purchase = (id: string, currency: "ARS" | "USD") => ({
  id,
  numero: 1,
  punto_venta: 3,
  letter: "A",
  kind: "factura",
  fecha: "2026-09-01",
  imp_total: 500,
  already_allocated: 0,
  outstanding: 500,
  currency,
});

const listPending = vi.fn();

const base = {
  channel_id: "jouve_fiscal",
  numero: 9,
  supplier_id: SUPPLIER,
  payment_date: "2026-11-05",
  total_amount: 200,
  currency: "ARS" as const,
  cotizacion: null,
  notes: null,
  payment_lines: [
    {
      line_kind: "account" as const,
      account_id: ACCOUNT,
      amount: 200,
      reference: null,
    },
  ],
  allocations: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  loadChannelPos.mockResolvedValue({ punto_venta: 3 });
  listPending.mockResolvedValue({
    ok: true,
    data: [purchase(USD_FC, "USD"), purchase(ARS_FC, "ARS")],
  });
  rpc.mockResolvedValue({ data: "op1", error: null });
});

describe("createPaymentOrder", () => {
  it("applies FIFO only over purchases in the OP's currency", async () => {
    const res = await createPaymentOrder(
      "u1",
      { ...base, allocation_mode: "fifo" },
      listPending,
    );
    expect(res).toEqual({
      ok: true,
      data: { id: "op1", numero: 9, punto_venta: 3 },
    });
    expect(rpc).toHaveBeenCalledWith(
      "create_payment_order",
      expect.objectContaining({
        p_allocations: [{ purchase_invoice_id: ARS_FC, amount_applied: 200 }],
        p_payment_lines: [
          {
            line_kind: "account",
            account_id: ACCOUNT,
            amount: 200,
            reference: null,
          },
        ],
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      "payment_order.created",
      "u1",
      expect.objectContaining({ numero: 9 }),
      "op1",
    );
  });

  it("a cuenta applies nothing and does not read the pending list", async () => {
    await createPaymentOrder(
      "u1",
      { ...base, allocation_mode: "a_cuenta" },
      listPending,
    );
    expect(listPending).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "create_payment_order",
      expect.objectContaining({ p_allocations: [] }),
    );
  });

  it("maps a database guard to its message and audits nothing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        hint: "jouve_guard",
        message: "Período cerrado.",
      },
    });
    const res = await createPaymentOrder(
      "u1",
      { ...base, allocation_mode: "a_cuenta" },
      listPending,
    );
    expect(res.ok).toBe(false);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
