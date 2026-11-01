import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Access, type Role } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// Imputing remitos internos de compra: the action reads through the service
// client, so its gate (both write permissions) is the only boundary; the
// caller comes from the session, and a guard refusal reaches the user as is.

const h = vi.hoisted(() => ({
  access: null as Access | null,
  rpc: { data: null, error: null } as FakeResponse,
  blockers: { data: [], error: null } as FakeResponse,
  tables: {} as Record<string, FakeResponse>,
  audit: vi.fn(async () => undefined),
}));

function respond(call: RecordedCall): FakeResponse {
  if (call.op === "rpc") {
    return call.table === "purchase_remito_blockers" ? h.blockers : h.rpc;
  }
  return h.tables[call.table] ?? { data: [], error: null };
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: h.audit }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
  imputePurchaseRemitosAction,
  listImputableRemitosAction,
  getPurchaseImputationsAction,
} = await import("./impute-remitos-actions");

const FACTURA = "11111111-1111-4111-8111-111111111111";
const REMITO = "22222222-2222-4222-8222-222222222222";
const NC = "33333333-3333-4333-8333-333333333333";
const SUPPLIER = "44444444-4444-4444-8444-444444444444";

function as(roles: Role[], denied: string[] = []) {
  h.access = resolveAccess(roles, denied);
}

beforeEach(() => {
  fake = recordingSupabase(respond);
  as(["finance"]);
  h.rpc = { data: [NC], error: null };
  h.blockers = { data: [], error: null };
  h.tables = {};
  h.audit.mockClear();
});

describe("imputePurchaseRemitosAction", () => {
  it.each<Role>(["operations", "warehouse", "driver", "fiscal_reader"])(
    "refuses %s before touching the DB",
    async (role) => {
      as([role]);
      const res = await imputePurchaseRemitosAction({
        factura_id: FACTURA,
        remito_ids: [REMITO],
      });
      expect(res.ok).toBe(false);
      expect(fake.calls).toEqual([]);
    },
  );

  it.each(["purchase_invoices:write", "payment_orders:write"])(
    "refuses a finance user whose %s is denied",
    async (perm) => {
      as(["finance"], [perm]);
      const res = await imputePurchaseRemitosAction({
        factura_id: FACTURA,
        remito_ids: [REMITO],
      });
      expect(res.ok).toBe(false);
      expect(fake.calls).toEqual([]);
    },
  );

  it("rejects an empty or malformed selection before the RPC", async () => {
    for (const input of [
      { factura_id: FACTURA, remito_ids: [] },
      { factura_id: "x", remito_ids: [REMITO] },
      { factura_id: FACTURA, remito_ids: ["x"] },
    ]) {
      const res = await imputePurchaseRemitosAction(input);
      expect(res.ok).toBe(false);
    }
    expect(fake.calls).toEqual([]);
  });

  it("imputes as the session user and audits", async () => {
    const res = await imputePurchaseRemitosAction({
      factura_id: FACTURA,
      remito_ids: [REMITO],
    });
    expect(res).toEqual({ ok: true, data: { nc_ids: [NC] } });
    const rpc = fake.calls.find((c) => c.op === "rpc");
    expect(rpc?.table).toBe("impute_purchase_remitos");
    expect(rpc?.payload).toEqual({
      p_factura_id: FACTURA,
      p_remito_ids: [REMITO],
      p_user_id: "u1",
    });
    expect(h.audit).toHaveBeenCalledWith(
      "purchase_invoice.remitos_imputed",
      "u1",
      { remito_ids: [REMITO] },
      FACTURA,
    );
  });

  it("returns a guard refusal as the user's error, without auditing", async () => {
    h.rpc = {
      data: null,
      error: {
        message:
          "El remito se pagó con cheques: anulá esa orden de pago, imputá el remito y cargá el pago en Compras.",
        hint: "jouve_guard",
        code: "23514",
      },
    };
    const res = await imputePurchaseRemitosAction({
      factura_id: FACTURA,
      remito_ids: [REMITO],
    });
    expect(res).toEqual({
      ok: false,
      error:
        "El remito se pagó con cheques: anulá esa orden de pago, imputá el remito y cargá el pago en Compras.",
    });
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("hides any other DB error behind a generic message", async () => {
    h.rpc = { data: null, error: { message: "deadlock", hint: null } };
    const res = await imputePurchaseRemitosAction({
      factura_id: FACTURA,
      remito_ids: [REMITO],
    });
    expect(res).toEqual({
      ok: false,
      error: "No se pudieron imputar los remitos.",
    });
  });
});

describe("listImputableRemitosAction", () => {
  it("lists only the supplier's remitos on internal channels, uncredited, in pesos", async () => {
    h.tables = {
      invoicing_channels: { data: [{ id: "jouve_internal" }], error: null },
      v_purchase_invoice_open: {
        data: [
          {
            purchase_invoice_id: REMITO,
            imp_total: 1000,
            amount_paid: 400,
            open_amount: 600,
          },
        ],
        error: null,
      },
      purchase_invoices: {
        data: [
          {
            id: REMITO,
            kind: "factura",
            letter: null,
            punto_venta: 1,
            numero: 7,
            fecha: "2026-10-01",
          },
        ],
        error: null,
      },
    };
    h.blockers = {
      data: [{ remito_id: REMITO, blocker: "El remito se pagó con cheques." }],
      error: null,
    };
    const res = await listImputableRemitosAction(SUPPLIER);
    expect(res).toEqual({
      ok: true,
      data: [
        {
          id: REMITO,
          label: "X00001-00000007",
          fecha: "2026-10-01",
          imp_total: 1000,
          paid: 400,
          blocker: "El remito se pagó con cheques.",
        },
      ],
    });
    const open = fake.calls.find((c) => c.table === "v_purchase_invoice_open");
    expect(open?.filters).toEqual(
      expect.arrayContaining([
        ["eq", "supplier_id", SUPPLIER],
        ["in", "channel_id", ["jouve_internal"]],
        ["eq", "kind", "factura"],
        ["eq", "status", "received"],
        ["eq", "moneda", "PES"],
        ["eq", "amount_credited_by_nc", 0],
        ["eq", "amount_opening_applied", 0],
      ]),
    );
  });

  it("fails loud when the read errors", async () => {
    h.tables = {
      invoicing_channels: { data: null, error: { message: "boom" } },
    };
    const res = await listImputableRemitosAction(SUPPLIER);
    expect(res.ok).toBe(false);
  });

  it("refuses a reader without purchase_invoices:write", async () => {
    as(["fiscal_reader"]);
    const res = await listImputableRemitosAction(SUPPLIER);
    expect(res.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe("getPurchaseImputationsAction", () => {
  it("fails loud instead of reporting nothing imputed", async () => {
    h.tables = { purchase_invoices: { data: null, error: { message: "x" } } };
    const res = await getPurchaseImputationsAction(FACTURA);
    expect(res.ok).toBe(false);
  });

  it("shows a fiscal-only user no internal remitos, without reading", async () => {
    as(["fiscal_reader"]);
    const res = await getPurchaseImputationsAction(FACTURA);
    expect(res).toEqual({ ok: true, data: { remitos: [], imputedTo: null } });
    expect(fake.calls).toEqual([]);
  });

  it("refuses a user without purchase_invoices:read", async () => {
    as(["driver"]);
    const res = await getPurchaseImputationsAction(FACTURA);
    expect(res.ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});
