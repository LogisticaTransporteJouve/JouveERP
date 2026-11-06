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

const { createReceipt } = await import("./create-receipt");

const CLIENT = "00000000-0000-4000-8000-000000000001";
const ACCOUNT = "00000000-0000-4000-8000-000000000002";
const OLD = "00000000-0000-4000-8000-000000000003";
const NEW = "00000000-0000-4000-8000-000000000004";

const pending = (id: string, fecha: string, outstanding: number) => ({
  id,
  document_type: "invoice" as const,
  numero: 1,
  punto_venta: 2,
  letter: "A",
  kind: "factura",
  fecha,
  imp_total: outstanding,
  already_allocated: 0,
  outstanding,
  currency: "ARS" as const,
  check_number: null,
});

const listPending = vi.fn();

const base = {
  channel_id: "jouve_fiscal",
  numero: 41,
  client_id: CLIENT,
  receipt_date: "2026-11-05",
  total_amount: 100,
  currency: "ARS" as const,
  cotizacion: null,
  notes: null,
  payment_lines: [{ account_id: ACCOUNT, amount: 100, reference: null }],
  allocations: [],
  retentions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  loadChannelPos.mockResolvedValue({ punto_venta: 2 });
  listPending.mockResolvedValue({
    ok: true,
    data: [pending(NEW, "2026-10-01", 80), pending(OLD, "2026-09-01", 50)],
  });
  rpc.mockResolvedValue({ data: "r1", error: null });
});

describe("createReceipt", () => {
  it("spreads the total oldest first and audits the receipt", async () => {
    const res = await createReceipt(
      "u1",
      { ...base, allocation_mode: "fifo" },
      listPending,
    );
    expect(res).toEqual({
      ok: true,
      data: { id: "r1", numero: 41, punto_venta: 2 },
    });
    expect(listPending).toHaveBeenCalledWith(CLIENT, "jouve_fiscal");
    expect(rpc).toHaveBeenCalledWith(
      "create_receipt",
      expect.objectContaining({
        p_punto_venta: 2,
        p_allocations: [
          { invoice_id: OLD, amount_applied: 50 },
          { invoice_id: NEW, amount_applied: 50 },
        ],
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      "receipt.created",
      "u1",
      expect.objectContaining({ numero: 41, total_amount: 100 }),
      "r1",
    );
  });

  it("refuses picked allocations a comprobante no longer has open", async () => {
    listPending.mockResolvedValue({
      ok: true,
      data: [pending(OLD, "2026-09-01", 20)],
    });
    const res = await createReceipt(
      "u1",
      {
        ...base,
        allocation_mode: "manual",
        allocations: [
          { invoice_id: OLD, amount_applied: 50 },
          { invoice_id: NEW, amount_applied: 50 },
        ],
      },
      listPending,
    );
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("names the taken number on a unique violation", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505" } });
    const res = await createReceipt(
      "u1",
      { ...base, allocation_mode: "a_cuenta" },
      listPending,
    );
    expect(res).toEqual({
      ok: false,
      error: "El número 41 ya existe para ese canal/POS.",
    });
  });

  it("refuses a channel with no enabled punto de venta", async () => {
    loadChannelPos.mockResolvedValue(null);
    const res = await createReceipt("u1", base, listPending);
    expect(res.ok).toBe(false);
    expect(listPending).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
