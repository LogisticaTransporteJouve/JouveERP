import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

let stored: Record<string, unknown> | null = null;
const fake = recordingSupabase((call: RecordedCall): FakeResponse =>
  call.op === "select"
    ? { data: stored, error: null }
    : { data: null, error: null },
);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["admin"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { updateMaintenanceAction } = await import("./maintenance-actions");

const ID = "11111111-1111-4111-8111-111111111111";
const INVOICE = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  fake.calls.length = 0;
  stored = { cost: 5000, purchase_invoice_id: INVOICE, transaction_id: null };
});

const updates = () => fake.calls.filter((c) => c.op === "update");

describe("updateMaintenanceAction", () => {
  it("refuses clearing the cost of a record whose invoice stays linked", async () => {
    const res = await updateMaintenanceAction({ id: ID, cost: "" });
    expect(res).toEqual({
      ok: false,
      error: "Cargá el costo del comprobante vinculado.",
    });
    expect(updates()).toHaveLength(0);
  });

  it("refuses linking an invoice to a record stored without a cost", async () => {
    stored = { cost: null, purchase_invoice_id: null, transaction_id: null };
    const res = await updateMaintenanceAction({
      id: ID,
      purchase_invoice_id: INVOICE,
    });
    expect(res.ok).toBe(false);
    expect(updates()).toHaveLength(0);
  });

  it("allows a blank cost once the link is removed too", async () => {
    const res = await updateMaintenanceAction({
      id: ID,
      cost: "",
      purchase_invoice_id: "",
    });
    expect(res.ok).toBe(true);
    expect(updates()).toHaveLength(1);
  });

  it("does not read the row when neither the cost nor a link changes", async () => {
    const res = await updateMaintenanceAction({ id: ID, notes: "ok" });
    expect(res.ok).toBe(true);
    expect(fake.calls.map((c) => c.op)).toEqual(["update"]);
  });
});
