// A fiscal-only reader (the external accountant) sees fiscal liquidaciones
// alone: every read goes through the service client, around the table's
// RLS, so each one filters by side itself.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";
import {
  filterValue,
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const FISCAL = "00000000-0000-4000-8000-0000000000f1";
const LEGACY_FISCAL = "00000000-0000-4000-8000-0000000000f2";
const INTERNAL = "00000000-0000-4000-8000-0000000000e1";
const INTERNAL_DRAFT = "00000000-0000-4000-8000-0000000000e2";
const FISCAL_CLIENT_X = "00000000-0000-4000-8000-0000000000e3";

let roles: Role[] = ["fiscal_reader"];
let listPages = 0;

function row(
  id: string,
  channel: string | null,
  clientIsFiscal: boolean,
  status = "confirmed",
) {
  return {
    id,
    numero: null,
    channel,
    remito_pos: channel === "fiscal" ? 9002 : null,
    remito_number: channel === "fiscal" ? 7 : null,
    client_id: "c1",
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    status,
    total: 1000,
    invoice_id: null,
    invoicing_claimed_at: null,
    notes: null,
    confirmed_at: "2026-11-01T12:00:00Z",
    created_at: "2026-11-01T12:00:00Z",
    client: {
      legal_name: `Cliente ${id.slice(-2)}`,
      email: "cliente@example.com",
      is_fiscal: clientIsFiscal,
      cuit: null,
      iva_condition: null,
    },
    invoice: null,
  };
}

const ROWS = [
  row(FISCAL, "fiscal", true),
  row(LEGACY_FISCAL, null, true, "invoiced"),
  row(INTERNAL, "internal", false),
  row(INTERNAL_DRAFT, null, false, "draft"),
  row(FISCAL_CLIENT_X, "internal", true),
];

function respond(call: RecordedCall) {
  if (call.table === "freight_settlements") {
    const id = filterValue(call, "eq", "id");
    // The list drains pages until an empty one.
    if (id === undefined) {
      listPages += 1;
      return { data: listPages === 1 ? ROWS : [], error: null };
    }
    return { data: ROWS.find((r) => r.id === id) ?? null, error: null };
  }
  if (call.table === "freight_settlement_items") {
    return { data: [], error: null };
  }
  if (call.table === "freight_settlement_candidates") {
    return {
      data: [{ shipment_id: "s1", amount: 100, price_source: "freight" }],
      error: null,
    };
  }
  return { data: null, error: null };
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles, []),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  issueFiscalInvoiceAction: vi.fn(),
}));

const {
  getFreightSettlementAction,
  listFreightSettlementCandidatesAction,
  listFreightSettlementsAction,
} = await import("./freight-settlements-actions");
const { getFreightSettlementEmailDefaultsAction } =
  await import("./send-freight-settlement-email");
const { buildFreightSettlementTemplateData } =
  await import("@/lib/pdf/freight-settlement-render");

beforeEach(() => {
  roles = ["fiscal_reader"];
  listPages = 0;
  fake = recordingSupabase(respond);
});

describe("fiscal_reader on liquidaciones", () => {
  it("lists only the fiscal side", async () => {
    const res = await listFreightSettlementsAction();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.map((s) => s.id)).toEqual([FISCAL, LEGACY_FISCAL]);
  });

  it("staff keep every liquidación", async () => {
    roles = ["finance"];
    const res = await listFreightSettlementsAction();
    expect(res.ok && res.data).toHaveLength(ROWS.length);
  });

  it("does not find an internal liquidación's detail", async () => {
    for (const id of [INTERNAL, INTERNAL_DRAFT, FISCAL_CLIENT_X]) {
      expect(await getFreightSettlementAction(id)).toEqual({
        ok: false,
        error: "No se encontró la liquidación.",
      });
    }
    expect((await getFreightSettlementAction(FISCAL)).ok).toBe(true);
  });

  it("reads no cargas candidates", async () => {
    const res = await listFreightSettlementCandidatesAction({
      client_id: "00000000-0000-4000-8000-0000000000c1",
      period_start: "2026-10-01",
      period_end: "2026-10-31",
    });
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("gets no email defaults (client email) of an internal one", async () => {
    expect(await getFreightSettlementEmailDefaultsAction(INTERNAL)).toEqual({
      ok: false,
      error: "Liquidación no encontrada.",
    });
    const fiscal = await getFreightSettlementEmailDefaultsAction(FISCAL);
    expect(fiscal.ok && fiscal.data.recipient).toBe("cliente@example.com");
  });

  it("gets no R PDF of an internal one", async () => {
    await expect(
      buildFreightSettlementTemplateData(
        INTERNAL,
        resolveAccess(["fiscal_reader"]),
      ),
    ).rejects.toThrow(/not found/);
    // Staff pass the scope and reach the document's own rule.
    await expect(
      buildFreightSettlementTemplateData(INTERNAL, resolveAccess(["finance"])),
    ).rejects.toThrow(/Otras ventas/);
  });
});
