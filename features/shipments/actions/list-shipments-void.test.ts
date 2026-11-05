import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const row = (id: string, invoiceId: string | null) => ({
  id,
  client_id: "c1",
  status: "delivered",
  freight_amount: "100.00",
  cod_amount: null,
  invoice_id: invoiceId,
});

let rows: unknown[] = [];
let voidRead: { data: unknown; error: unknown } = { data: [], error: null };
let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.table === "shipments") return { data: rows, error: null };
  if (call.table === "billing_void_invoice_ids") return voidRead;
  return { data: null, error: null };
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["owner"], []),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  issueFiscalInvoiceAction: vi.fn(),
}));

const { listShipmentsAction } = await import("./shipments-actions");

beforeEach(() => {
  rows = [row("s1", "inv-live"), row("s2", "inv-credited"), row("s3", null)];
  voidRead = { data: ["inv-credited"], error: null };
  fake = recordingSupabase(respond);
});

describe("listShipmentsAction", () => {
  it("marks a carga whose invoice no longer bills it, asking only for linked invoices", async () => {
    const res = await listShipmentsAction();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.map((s) => [s.id, s.invoice_void])).toEqual([
      ["s1", false],
      ["s2", true],
      ["s3", false],
    ]);
    const probe = fake.calls.find(
      (c) => c.table === "billing_void_invoice_ids",
    );
    expect(probe?.payload).toEqual({
      p_invoice_ids: ["inv-live", "inv-credited"],
    });
  });

  it("fails instead of showing a void invoice as billing its carga", async () => {
    voidRead = { data: null, error: { message: "boom" } };
    const res = await listShipmentsAction();
    expect(res).toEqual({
      ok: false,
      error: "No se pudieron listar las cargas.",
    });
  });
});
