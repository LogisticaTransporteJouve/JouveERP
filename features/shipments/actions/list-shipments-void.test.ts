import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";
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
let role: Role = "owner";
// The viewer's client reads the cargas; the service client reads the void
// rule (operations cannot read invoices).
let fake = recordingSupabase(respond);
let service = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.table === "shipments") return { data: rows, error: null };
  if (call.table === "billing_void_invoice_ids") return voidRead;
  return { data: null, error: null };
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess([role], []),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => service.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  issueFiscalInvoiceAction: vi.fn(),
}));

const { listShipmentsAction } = await import("./shipments-actions");

beforeEach(() => {
  rows = [row("s1", "inv-live"), row("s2", "inv-credited"), row("s3", null)];
  voidRead = { data: ["inv-credited"], error: null };
  role = "owner";
  fake = recordingSupabase(respond);
  service = recordingSupabase(respond);
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
    const probe = service.calls.find(
      (c) => c.table === "billing_void_invoice_ids",
    );
    expect(probe?.payload).toEqual({
      p_invoice_ids: ["inv-live", "inv-credited"],
    });
  });

  it("gives operations, who cannot read invoices, the same answer", async () => {
    role = "operations";
    const res = await listShipmentsAction();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.find((s) => s.id === "s2")?.invoice_void).toBe(true);
    // The rule is not read under the viewer's RLS, which hides the invoice.
    expect(fake.calls.some((c) => c.table === "billing_void_invoice_ids")).toBe(
      false,
    );
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
