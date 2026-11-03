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
let denies: string[] = [];
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
  if (call.table === "post_driver_settlement_difference") {
    const payload = call.payload as { p_charged_to?: string } | undefined;
    const data = payload?.p_charged_to === "client" ? null : "m1";
    return { data: rpcError ? null : data, error: rpcError };
  }
  if (call.table === "driver_settlements" && listingItems) {
    return {
      data: [
        {
          id: SETTLEMENT,
          numero: 7,
          driver_id: DRIVER,
          settlement_date: "2026-11-02",
          status: "confirmed",
          notes: null,
          difference_charged_to: "client",
          created_at: "2026-11-02T10:00:00Z",
          driver: { full_name: "Juan", employee_id: "e1" },
          difference: [],
        },
      ],
      error: null,
    };
  }
  if (call.table === "driver_settlement_items" && listingItems) {
    return {
      data: [
        {
          id: "i1",
          settlement_id: SETTLEMENT,
          shipment_id: SHIPMENT,
          expected_amount: 1000,
          note: null,
          released: false,
          lines: [
            {
              id: "l1",
              account_id: ACCOUNT,
              amount: 600,
              reference: null,
              check_number: null,
              bank_name: null,
              drawer_name: null,
              check_due_date: null,
              receipt_id: "r1",
              account: { name: "Caja", type: "cash" },
              receipt: {
                punto_venta: 1,
                numero: 5,
                status: "issued",
                total_amount: 700,
              },
            },
            {
              id: "l2",
              account_id: ACCOUNT,
              amount: 300,
              reference: null,
              check_number: null,
              bank_name: null,
              drawer_name: null,
              check_due_date: null,
              receipt_id: "r1",
              account: { name: "Caja", type: "cash" },
              receipt: {
                punto_venta: 1,
                numero: 5,
                status: "issued",
                total_amount: 700,
              },
            },
          ],
        },
      ],
      error: null,
    };
  }
  if (
    call.table === "cancel_driver_settlement" ||
    call.table === "unpost_driver_settlement_difference"
  ) {
    return { data: null, error: rpcError };
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
    access: resolveAccess(roles, denies),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const {
  cancelDriverSettlementAction,
  confirmDriverSettlementAction,
  listCodPendingAction,
  listDriverSettlementsAction,
  postDriverSettlementDifferenceAction,
  saveDriverSettlementAction,
  unpostDriverSettlementDifferenceAction,
} = await import("./driver-settlements-actions");

let listingItems = false;

beforeEach(() => {
  roles = ["finance"];
  denies = [];
  listingItems = false;
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

describe("listDriverSettlementsAction", () => {
  it("flags a receipt whose total changed in Recibos", async () => {
    listingItems = true;
    const res = await listDriverSettlementsAction({ offset: 0, limit: 25 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [s] = res.data.settlements;
    expect(s?.difference).toBe(-100);
    expect(s?.receipts).toEqual([
      { id: "r1", label: expect.any(String), canceled: false, mismatch: true },
    ]);
    expect(s?.receipts_out_of_sync).toBe(true);
    expect(s?.driver_employee_id).toBe("e1");
    expect(s?.difference_charged_to).toBe("client");
    expect(res.data.nextOffset).toBeNull();
  });
});

describe("postDriverSettlementDifferenceAction", () => {
  it("charges the driver with the acting user", async () => {
    const res = await postDriverSettlementDifferenceAction({
      id: SETTLEMENT,
      charged_to: "driver",
    });
    expect(res).toEqual({ ok: true, data: { movementId: "m1" } });
    const call = fake.calls.find(
      (c) => c.table === "post_driver_settlement_difference",
    );
    expect(call?.payload).toEqual({
      p_settlement_id: SETTLEMENT,
      p_user_id: "u1",
      p_charged_to: "driver",
    });
  });

  it("leaves it to the client without a movement and without hr:write", async () => {
    denies = ["hr:write"];
    const res = await postDriverSettlementDifferenceAction({
      id: SETTLEMENT,
      charged_to: "client",
    });
    expect(res).toEqual({ ok: true, data: { movementId: null } });
    const call = fake.calls.find(
      (c) => c.table === "post_driver_settlement_difference",
    );
    expect(call?.payload).toMatchObject({ p_charged_to: "client" });
  });

  it("charging the driver needs hr:write besides receipts:write", async () => {
    denies = ["hr:write"];
    const res = await postDriverSettlementDifferenceAction({
      id: SETTLEMENT,
      charged_to: "driver",
    });
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses an unknown side", async () => {
    const res = await postDriverSettlementDifferenceAction({
      id: SETTLEMENT,
      // @ts-expect-error: only driver | client
      charged_to: "both",
    });
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});

// Cancel and unpost take the difference back; without hr:write the RPC
// refuses when the driver's account holds it (p_allow_driver false).
describe.each([
  ["cancelDriverSettlementAction", "cancel_driver_settlement"],
  [
    "unpostDriverSettlementDifferenceAction",
    "unpost_driver_settlement_difference",
  ],
] as const)("%s", (name, rpc) => {
  const action =
    name === "cancelDriverSettlementAction"
      ? cancelDriverSettlementAction
      : unpostDriverSettlementDifferenceAction;

  it("lets the driver's movement go with hr:write", async () => {
    expect((await action({ id: SETTLEMENT })).ok).toBe(true);
    const call = fake.calls.find((c) => c.table === rpc);
    expect(call?.payload).toMatchObject({
      p_settlement_id: SETTLEMENT,
      p_user_id: "u1",
      p_allow_driver: true,
    });
  });

  it("asks the RPC to keep the driver's movement without hr:write", async () => {
    denies = ["hr:write"];
    expect((await action({ id: SETTLEMENT })).ok).toBe(true);
    const call = fake.calls.find((c) => c.table === rpc);
    expect(call?.payload).toMatchObject({ p_allow_driver: false });
  });

  it("shows the RPC's refusal", async () => {
    denies = ["hr:write"];
    rpcError = {
      message:
        "La diferencia de la rendición está en la cuenta corriente del chofer: quitarla requiere permiso de escritura en RRHH.",
      hint: "jouve_guard",
      code: "55006",
    };
    const res = await action({ id: SETTLEMENT });
    expect(res).toEqual({
      ok: false,
      error:
        "La diferencia de la rendición está en la cuenta corriente del chofer: quitarla requiere permiso de escritura en RRHH.",
    });
  });

  it("needs receipts:write", async () => {
    roles = ["operations"];
    expect((await action({ id: SETTLEMENT })).ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});
