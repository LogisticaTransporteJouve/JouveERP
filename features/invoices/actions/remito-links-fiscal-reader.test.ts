import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Access, resolveAccess } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// getRemitoLinksAction reads through the service client, so the fiscal_reader
// RLS on invoices does not reach it: a fiscal-only user must not learn of the
// remito interno a fiscal factura was billed from.

const h = vi.hoisted(() => ({ access: null as Access | null }));

const FACTURA = "11111111-1111-4111-8111-111111111111";
const REMITO = "22222222-2222-4222-8222-222222222222";

const ROWS: Record<string, Record<string, unknown>> = {
  [FACTURA]: {
    id: FACTURA,
    kind: "factura",
    letter: "A",
    punto_venta: 3,
    numero: 10,
    source_remito_id: REMITO,
    channel: { is_fiscal: true },
  },
  [REMITO]: {
    id: REMITO,
    kind: "factura",
    letter: null,
    punto_venta: 9001,
    numero: 7,
    source_remito_id: null,
    channel: { is_fiscal: false },
  },
};

let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  const byId = call.filters.find(([k, c]) => k === "eq" && c === "id");
  if (byId) return { data: ROWS[String(byId[2])] ?? null, error: null };
  const bySource = call.filters.find(
    ([k, c]) => k === "eq" && c === "source_remito_id",
  );
  if (bySource) {
    return {
      data: bySource[2] === REMITO ? ROWS[FACTURA] : null,
      error: null,
    };
  }
  return { data: null, error: null };
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn() } }));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { getRemitoLinksAction } = await import("./bill-remito-actions");

beforeEach(() => {
  fake = recordingSupabase(respond);
  h.access = resolveAccess(["finance"]);
});

describe("getRemitoLinksAction", () => {
  it("links a billed factura to its remito for a finance user", async () => {
    const res = await getRemitoLinksAction(FACTURA);
    expect(res.ok && res.data.sourceRemito).toEqual({
      id: REMITO,
      label: "X9001-00000007",
    });
  });

  it("links a remito to the factura that billed it", async () => {
    const res = await getRemitoLinksAction(REMITO);
    expect(res.ok && res.data.billedAs?.id).toBe(FACTURA);
  });

  it("does not reveal the remito interno to a fiscal-only user", async () => {
    h.access = resolveAccess(["fiscal_reader"]);
    const res = await getRemitoLinksAction(FACTURA);
    expect(res.ok && res.data.sourceRemito).toBeNull();
  });

  it("a fiscal-only user asking for a remito interno id learns nothing", async () => {
    h.access = resolveAccess(["fiscal_reader"]);
    const res = await getRemitoLinksAction(REMITO);
    expect(res.ok ? res.data : null).toEqual(
      res.ok ? { billedAs: null, sourceRemito: null } : null,
    );
  });

  it("refuses a role without invoices:read before any read", async () => {
    h.access = resolveAccess(["warehouse"]);
    const res = await getRemitoLinksAction(FACTURA);
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});
