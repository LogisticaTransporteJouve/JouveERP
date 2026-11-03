import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const DRIVER = "00000000-0000-4000-8000-000000000001";
const SHIPMENT = "00000000-0000-4000-8000-000000000002";
const ACCOUNT = "00000000-0000-4000-8000-000000000003";
const SETTLEMENT = "00000000-0000-4000-8000-000000000004";

let roles: Role[] = ["finance"];
let rpcError: unknown = null;
let fake = recordingSupabase(respond);

// paginateRange reads until an empty page: each table answers once.
const served = new Set<string>();

function respond(call: RecordedCall) {
  if (call.op === "select") {
    if (served.has(call.table)) return { data: [], error: null };
    served.add(call.table);
  }
  if (call.table === "save_driver_settlement") {
    return { data: rpcError ? null : SETTLEMENT, error: rpcError };
  }
  if (call.table === "confirm_driver_settlement") {
    return { data: rpcError ? null : ["r1", "r2"], error: rpcError };
  }
  if (call.table === "shipments") {
    return {
      data: [
        {
          id: SHIPMENT,
          remito_number: "0001-9",
          delivery_date: "2026-11-01",
          origin: "A",
          destination: "B",
          cod_amount: "1500.50",
          client: { legal_name: "Cliente" },
          trip: { driver_id: DRIVER, driver: { full_name: "Juan" } },
        },
        {
          id: "taken",
          remito_number: null,
          delivery_date: "2026-11-01",
          origin: null,
          destination: null,
          cod_amount: 10,
          client: { legal_name: "Otro" },
          trip: null,
        },
      ],
      error: null,
    };
  }
  if (call.table === "driver_settlement_items") {
    return { data: [{ shipment_id: "taken" }], error: null };
  }
  return { data: [], error: null };
}

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

const {
  confirmDriverSettlementAction,
  listCodPendingAction,
  saveDriverSettlementAction,
} = await import("./driver-settlements-actions");

beforeEach(() => {
  roles = ["finance"];
  rpcError = null;
  served.clear();
  fake = recordingSupabase(respond);
});

describe("saveDriverSettlementAction", () => {
  const input = {
    driver_id: DRIVER,
    settlement_date: "2026-11-03",
    items: [
      {
        shipment_id: SHIPMENT,
        lines: [
          {
            account_id: ACCOUNT,
            amount: "1500.50",
            check_number: "123",
            bank_name: "Nación",
            check_due_date: "2026-12-01",
          },
        ],
      },
    ],
  };

  it("sends the cargas and lines with the acting user", async () => {
    const res = await saveDriverSettlementAction(input);
    expect(res).toEqual({ ok: true, data: { id: SETTLEMENT } });
    const call = fake.calls.find((c) => c.table === "save_driver_settlement");
    expect(call?.payload).toMatchObject({
      p_driver_id: DRIVER,
      p_user_id: "u1",
      p_items: [
        {
          shipment_id: SHIPMENT,
          note: null,
          lines: [
            {
              account_id: ACCOUNT,
              amount: 1500.5,
              check_number: "123",
              check_due_date: "2026-12-01",
              reference: null,
            },
          ],
        },
      ],
    });
    expect(call?.payload).not.toHaveProperty("p_settlement_id");
  });

  it("shows a database guard's message", async () => {
    rpcError = {
      message: "La carga 0001-9 no viajó con este chofer.",
      hint: "jouve_guard",
      code: "23514",
    };
    const res = await saveDriverSettlementAction(input);
    expect(res).toEqual({
      ok: false,
      error: "La carga 0001-9 no viajó con este chofer.",
    });
  });

  it("needs receipts:write", async () => {
    roles = ["operations"];
    expect((await saveDriverSettlementAction(input)).ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("confirmDriverSettlementAction", () => {
  it("returns the receipts the rendición posted", async () => {
    const res = await confirmDriverSettlementAction({ id: SETTLEMENT });
    expect(res).toEqual({ ok: true, data: { receiptIds: ["r1", "r2"] } });
  });
});

describe("listCodPendingAction", () => {
  it("leaves out cargas already in a live rendición and groups per driver", async () => {
    const res = await listCodPendingAction();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.shipments.map((s) => s.shipment_id)).toEqual([SHIPMENT]);
    expect(res.data.shipments[0]?.cod_amount).toBe(1500.5);
    expect(res.data.byDriver).toEqual([
      {
        driver_id: DRIVER,
        driver_name: "Juan",
        cargas: 1,
        amount: 1500.5,
        drafts: 0,
      },
    ]);
  });
});
