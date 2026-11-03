import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const listFreightSettlementsAction = vi.fn();
const listAllDriverSettlementsAction = vi.fn();
const listCodPendingAction = vi.fn();

vi.mock(
  "@/features/freight-settlements/actions/freight-settlements-actions",
  () => ({ listFreightSettlementsAction }),
);
vi.mock(
  "@/features/driver-settlements/actions/driver-settlements-actions",
  () => ({ listAllDriverSettlementsAction, listCodPendingAction }),
);

const { getDriverSettlements, getFreightSettlements } =
  await import("./settlements");

const ctx = { userId: "u1", access: resolveAccess(["owner"]) };

function freight(patch: Record<string, unknown>) {
  return {
    id: "f1",
    numero: null,
    channel: "fiscal",
    remito_pos: 1,
    remito_number: 3,
    invoice_number: null,
    client_id: "c1",
    client_name: "Cliente Uno",
    client_is_fiscal: true,
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    status: "confirmed",
    total: 1000,
    invoice_id: null,
    invoice_status: null,
    invoicing: false,
    notes: null,
    created_at: "2026-11-01T00:00:00Z",
    ...patch,
  };
}

function settlement(patch: Record<string, unknown>) {
  return {
    id: "s1",
    numero: 7,
    driver_id: "d1",
    driver_name: "Juan Pérez",
    driver_employee_id: "e1",
    settlement_date: "2026-11-02",
    status: "confirmed",
    notes: null,
    expected_total: 1000,
    received_total: 900,
    difference: -100,
    cargas: 2,
    receipts: [],
    receipts_out_of_sync: false,
    difference_charged_to: null,
    difference_posted: null,
    created_at: "2026-11-02T00:00:00Z",
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getFreightSettlements", () => {
  it("filters by status, scope and client and totals what is left to bill", async () => {
    listFreightSettlementsAction.mockResolvedValue({
      ok: true,
      data: [
        freight({}),
        freight({ id: "f2", status: "invoiced" }),
        freight({ id: "f3", channel: "internal", client_is_fiscal: false }),
        freight({ id: "f4", client_name: "Otro" }),
        // The side is the confirmed channel, not the client's current flag.
        freight({ id: "f5", channel: "internal", client_is_fiscal: true }),
        freight({ id: "f6", channel: "fiscal", client_is_fiscal: false }),
        // A draft follows its client.
        freight({ id: "f7", channel: null, client_is_fiscal: false }),
      ],
    });
    const res = await getFreightSettlements.execute(ctx, {
      status: "confirmed",
      scope: "fiscal",
      client_name: "uno",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.data as { rows: { id: string; document: string }[] };
    expect(data.rows.map((r) => r.id)).toEqual(["f1", "f6"]);
    expect(data.rows[0]?.document).toBe("Remito R0001-00000003");
    expect(res.summary).toContain("2 confirmadas sin facturar");

    const internal = await getFreightSettlements.execute(ctx, {
      status: "confirmed",
      scope: "internal",
      client_name: "uno",
    });
    expect(internal.ok).toBe(true);
    if (!internal.ok) return;
    const rows = (internal.data as { rows: { id: string }[] }).rows;
    expect(rows.map((r) => r.id)).toEqual(["f3", "f5", "f7"]);
  });

  it("pins a fiscal-only reader to the fiscal side, whatever scope it asks", async () => {
    listFreightSettlementsAction.mockResolvedValue({
      ok: true,
      data: [
        freight({}),
        freight({ id: "f2", channel: "internal", client_is_fiscal: false }),
        freight({ id: "f3", channel: null, client_is_fiscal: false }),
      ],
    });
    const reader = { userId: "u2", access: resolveAccess(["fiscal_reader"]) };
    for (const scope of ["internal", "all"] as const) {
      const res = await getFreightSettlements.execute(reader, { scope });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const rows = (res.data as { rows: { id: string }[] }).rows;
      expect(rows.map((r) => r.id)).toEqual(["f1"]);
    }
  });
});

describe("getDriverSettlements", () => {
  it("reads the rendiciones and the pending cargas per driver", async () => {
    listCodPendingAction.mockResolvedValue({
      ok: true,
      data: {
        shipments: [],
        byDriver: [
          {
            driver_id: "d1",
            driver_name: "Juan Pérez",
            cargas: 2,
            amount: 500,
            drafts: 0,
          },
        ],
      },
    });
    listAllDriverSettlementsAction.mockResolvedValue({
      ok: true,
      data: {
        settlements: [settlement({}), settlement({ id: "s2", difference: 0 })],
        complete: false,
      },
    });
    const res = await getDriverSettlements.execute(ctx, {
      only_with_difference: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Stopped at the read cap: the result says it is partial.
    expect(res.meta?.partial).toBe(true);
    const data = res.data as { settlements: { id: string }[] };
    expect(data.settlements.map((s) => s.id)).toEqual(["s1"]);
    expect(res.summary).toContain("2 cargas por rendir");
  });

  it("tells a settled driver advance apart from a legacy driver charge", async () => {
    listCodPendingAction.mockResolvedValue({
      ok: true,
      data: { shipments: [], byDriver: [] },
    });
    listAllDriverSettlementsAction.mockResolvedValue({
      ok: true,
      data: {
        settlements: [
          settlement({
            difference_charged_to: "driver",
            difference_posted: { id: "m1", kind: "advance", amount: 100 },
          }),
          // Posted the old way (a charge): the client side is still open.
          settlement({
            id: "s2",
            difference_charged_to: "driver",
            difference_posted: { id: "m2", kind: "charge", amount: 100 },
          }),
        ],
        complete: true,
      },
    });
    const res = await getDriverSettlements.execute(ctx, {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.data as {
      settlements: { id: string; difference_kind: string | null }[];
    };
    expect(data.settlements.map((s) => [s.id, s.difference_kind])).toEqual([
      ["s1", "advance"],
      ["s2", "charge"],
    ]);
  });

  it("returns the action's error", async () => {
    listCodPendingAction.mockResolvedValue({ ok: false, error: "boom" });
    const res = await getDriverSettlements.execute(ctx, {});
    expect(res.ok).toBe(false);
  });
});
