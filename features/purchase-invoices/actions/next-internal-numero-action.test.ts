import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Access, type Role } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const h = vi.hoisted(() => ({
  access: null as Access | null,
  isFiscal: false as boolean | null,
  next: 7,
}));

function respond(call: RecordedCall) {
  if (call.table === "invoicing_channels") {
    return {
      data: h.isFiscal === null ? null : { is_fiscal: h.isFiscal },
      error: null,
    };
  }
  if (call.op === "rpc" && call.table === "next_internal_purchase_numero") {
    return { data: h.next, error: null };
  }
  return { data: null, error: null };
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { nextInternalPurchaseNumeroAction } =
  await import("./purchase-invoices-actions");

const SUPPLIER = "11111111-1111-4111-8111-111111111111";
const input = {
  channelId: "jouve_internal",
  supplierId: SUPPLIER,
  kind: "factura",
};

function as(roles: Role[], denied: string[] = []) {
  h.access = resolveAccess(roles, denied);
}

beforeEach(() => {
  fake = recordingSupabase(respond);
  as(["owner"]);
  h.isFiscal = false;
  h.next = 7;
});

describe("nextInternalPurchaseNumeroAction", () => {
  it("is refused without purchase_invoices:write and touches nothing", async () => {
    as(["admin"], ["purchase_invoices:write"]);
    const res = await nextInternalPurchaseNumeroAction(input);
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects a fiscal channel without calling the RPC", async () => {
    h.isFiscal = true;
    const res = await nextInternalPurchaseNumeroAction({
      ...input,
      channelId: "jouve_fiscal",
    });
    expect(res.ok).toBe(false);
    expect(fake.calls.some((c) => c.op === "rpc")).toBe(false);
  });

  it("rejects an unknown channel", async () => {
    h.isFiscal = null;
    const res = await nextInternalPurchaseNumeroAction(input);
    expect(res.ok).toBe(false);
    expect(fake.calls.some((c) => c.op === "rpc")).toBe(false);
  });

  it("asks the RPC for the supplier's kind and PV series", async () => {
    const res = await nextInternalPurchaseNumeroAction({
      ...input,
      kind: "nc",
      puntoVenta: 2,
    });
    expect(res).toEqual({ ok: true, data: 7 });
    const rpc = fake.calls.find((c) => c.op === "rpc");
    expect(rpc?.table).toBe("next_internal_purchase_numero");
    expect(rpc?.payload).toEqual({
      p_supplier_id: SUPPLIER,
      p_kind: "nc",
      p_punto_venta: 2,
    });
  });

  it("defaults the punto de venta to 1", async () => {
    await nextInternalPurchaseNumeroAction(input);
    const rpc = fake.calls.find((c) => c.op === "rpc");
    expect(rpc?.payload).toEqual({
      p_supplier_id: SUPPLIER,
      p_kind: "factura",
      p_punto_venta: 1,
    });
  });
});
