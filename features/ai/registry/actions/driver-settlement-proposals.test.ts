import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const listCodPendingAction = vi.fn();
const listDriverSettlementAccountsAction = vi.fn();
const getDriverSettlementAction = vi.fn();
const saveDriverSettlement = vi.fn();
const confirmDriverSettlement = vi.fn();
const postDriverSettlementDifference = vi.fn();

vi.mock(
  "@/features/driver-settlements/actions/driver-settlements-actions",
  () => ({
    listCodPendingAction,
    listDriverSettlementAccountsAction,
    getDriverSettlementAction,
  }),
);
vi.mock("@/lib/commands/driver-settlements", () => ({
  saveDriverSettlement,
  confirmDriverSettlement,
  postDriverSettlementDifference,
}));

const {
  proposeDriverSettlement,
  proposeDriverSettlementConfirm,
  proposeDriverSettlementDifference,
} = await import("./driver-settlement-proposals");

const finance = { userId: "u1", access: resolveAccess(["finance"]) };
const DRIVER = "00000000-0000-4000-8000-0000000000d1";
const S1 = "00000000-0000-4000-8000-0000000000a1";
const S2 = "00000000-0000-4000-8000-0000000000a2";
const CAJA = "00000000-0000-4000-8000-0000000000b1";
const CAJA_CHICA = "00000000-0000-4000-8000-0000000000b2";
const CARTERA = "00000000-0000-4000-8000-0000000000b3";
const SETTLEMENT = "00000000-0000-4000-8000-0000000000e1";

const carga = (id: string, remito: string, amount: number) => ({
  shipment_id: id,
  driver_id: DRIVER,
  driver_name: "Juan Pérez",
  remito_number: remito,
  client_name: "Acme SA",
  delivery_date: "2026-11-02",
  origin: null,
  destination: null,
  cod_amount: amount,
});

beforeEach(() => {
  vi.clearAllMocks();
  listCodPendingAction.mockResolvedValue({
    ok: true,
    data: {
      shipments: [carga(S1, "R-1", 100_000), carga(S2, "R-2", 50_000)],
      byDriver: [
        {
          driver_id: DRIVER,
          driver_name: "Juan Pérez",
          cargas: 2,
          amount: 150_000,
          drafts: 0,
        },
      ],
    },
  });
  listDriverSettlementAccountsAction.mockResolvedValue({
    ok: true,
    data: [
      { id: CAJA, name: "Caja", type: "cash" },
      { id: CARTERA, name: "Cheques en cartera", type: "checks" },
    ],
  });
});

describe("proposeDriverSettlement", () => {
  it("drafts everything handed in, at the server's amounts, in the only cash account", async () => {
    const prepared = await proposeDriverSettlement.proposal?.prepareDraft(
      finance,
      { driver: "Pérez", all_collected: true, settlement_date: "2026-11-03" },
    );
    if (prepared?.kind !== "draft") throw new Error("no draft");
    expect(prepared.draft).toEqual({
      id: null,
      driver_id: DRIVER,
      settlement_date: "2026-11-03",
      notes: null,
      items: [
        {
          shipment_id: S1,
          note: null,
          lines: [{ account_id: CAJA, amount: 100_000 }],
        },
        {
          shipment_id: S2,
          note: null,
          lines: [{ account_id: CAJA, amount: 50_000 }],
        },
      ],
    });
    expect(prepared.summary).toContainEqual({
      label: "Tenía que cobrar",
      value: "$ 150.000,00",
    });

    saveDriverSettlement.mockResolvedValue({ ok: true, data: { id: "ds1" } });
    const res = await proposeDriverSettlement.proposal?.executeDraft(
      finance,
      prepared.draft,
    );
    expect(res).toEqual({ ok: true, data: { id: "ds1" } });
    expect(saveDriverSettlement).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ driver_id: DRIVER }),
    );
  });

  it("asks how much he handed in when the user did not say it", async () => {
    const prepared = await proposeDriverSettlement.proposal?.prepareDraft(
      finance,
      { driver: "Juan Pérez" },
    );
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "items" }],
    });
  });

  it("asks how a short total splits across several cargas", async () => {
    const prepared = await proposeDriverSettlement.proposal?.prepareDraft(
      finance,
      { driver: "Juan Pérez", received_total: 120_000 },
    );
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "items" }],
    });
  });

  it("takes per-carga amounts by remito; nothing handed in is a carga with no line", async () => {
    const prepared = await proposeDriverSettlement.proposal?.prepareDraft(
      finance,
      {
        driver: "Juan Pérez",
        items: [
          { shipment: "r 1", amount: 90_000 },
          { shipment: "R-2", amount: 0 },
        ],
      },
    );
    if (prepared?.kind !== "draft") throw new Error("no draft");
    expect(prepared.draft).toMatchObject({
      items: [
        { shipment_id: S1, lines: [{ account_id: CAJA, amount: 90_000 }] },
        { shipment_id: S2, lines: [] },
      ],
    });
    expect(prepared.summary).toContainEqual({
      label: "Faltante",
      value: "$ 60.000,00",
    });
  });

  it("asks the account when there is more than one cash account, and refuses a check one", async () => {
    listDriverSettlementAccountsAction.mockResolvedValue({
      ok: true,
      data: [
        { id: CAJA, name: "Caja", type: "cash" },
        { id: CAJA_CHICA, name: "Caja chica", type: "cash" },
        { id: CARTERA, name: "Cheques en cartera", type: "checks" },
      ],
    });
    const ask = await proposeDriverSettlement.proposal?.prepareDraft(finance, {
      driver: "Juan Pérez",
      all_collected: true,
    });
    expect(ask).toMatchObject({
      kind: "issues",
      issues: [{ field: "account" }],
    });

    const check = await proposeDriverSettlement.proposal?.prepareDraft(
      finance,
      { driver: "Juan Pérez", all_collected: true, account: "Cheques" },
    );
    expect(check).toMatchObject({ kind: "error" });
  });

  it("refuses a driver with nothing pending", async () => {
    const prepared = await proposeDriverSettlement.proposal?.prepareDraft(
      finance,
      { driver: "Gómez", all_collected: true },
    );
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "driver" }],
    });
  });
});

const detail = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    id: SETTLEMENT,
    numero: null,
    driver_id: DRIVER,
    driver_name: "Juan Pérez",
    driver_employee_id: "emp1",
    settlement_date: "2026-11-03",
    status: "draft",
    expected_total: 150_000,
    received_total: 140_000,
    difference: -10_000,
    difference_charged_to: null,
    difference_posted: null,
    receipts_out_of_sync: false,
    items: [{ id: "i1" }, { id: "i2" }],
    ...over,
  },
});

describe("proposeDriverSettlementConfirm", () => {
  it("confirms at the totals the server showed", async () => {
    getDriverSettlementAction.mockResolvedValue(detail());
    const prepared =
      await proposeDriverSettlementConfirm.proposal?.prepareDraft(finance, {
        settlement_id: SETTLEMENT,
      });
    if (prepared?.kind !== "draft") throw new Error("no draft");
    expect(prepared.draft).toEqual({
      id: SETTLEMENT,
      expected_total: 150_000,
      received_total: 140_000,
    });
    confirmDriverSettlement.mockResolvedValue({
      ok: true,
      data: { receiptIds: ["r1", "r2"] },
    });
    const res = await proposeDriverSettlementConfirm.proposal?.executeDraft(
      finance,
      prepared.draft,
    );
    expect(confirmDriverSettlement).toHaveBeenCalledWith("u1", SETTLEMENT, {
      id: SETTLEMENT,
      expected_total: 150_000,
      received_total: 140_000,
    });
    expect(res).toEqual({
      ok: true,
      data: { id: SETTLEMENT, note: "2 recibos" },
    });
  });

  it("refuses a confirmed rendición", async () => {
    getDriverSettlementAction.mockResolvedValue(
      detail({ status: "confirmed" }),
    );
    const prepared =
      await proposeDriverSettlementConfirm.proposal?.prepareDraft(finance, {
        settlement_id: SETTLEMENT,
      });
    expect(prepared).toMatchObject({ kind: "error" });
  });
});

describe("proposeDriverSettlementDifference", () => {
  it("asks who bears a faltante when the driver can", async () => {
    getDriverSettlementAction.mockResolvedValue(
      detail({ status: "confirmed" }),
    );
    const prepared =
      await proposeDriverSettlementDifference.proposal?.prepareDraft(finance, {
        settlement_id: SETTLEMENT,
      });
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "charged_to" }],
    });
  });

  it("leaves it to the client when the driver is hired, and refuses charging him", async () => {
    getDriverSettlementAction.mockResolvedValue(
      detail({ status: "confirmed", driver_employee_id: null }),
    );
    const prepared =
      await proposeDriverSettlementDifference.proposal?.prepareDraft(finance, {
        settlement_id: SETTLEMENT,
      });
    expect(prepared).toMatchObject({
      kind: "draft",
      draft: { id: SETTLEMENT, charged_to: "client" },
    });
    const driver =
      await proposeDriverSettlementDifference.proposal?.prepareDraft(finance, {
        settlement_id: SETTLEMENT,
        charged_to: "driver",
      });
    expect(driver).toMatchObject({ kind: "error" });
  });

  it("charges the driver through the command when the user holds both permissions", async () => {
    getDriverSettlementAction.mockResolvedValue(
      detail({ status: "confirmed" }),
    );
    const prepared =
      await proposeDriverSettlementDifference.proposal?.prepareDraft(finance, {
        settlement_id: SETTLEMENT,
        charged_to: "driver",
      });
    if (prepared?.kind !== "draft") throw new Error("no draft");
    postDriverSettlementDifference.mockResolvedValue({
      ok: true,
      data: { movementId: "m1" },
    });
    const res = await proposeDriverSettlementDifference.proposal?.executeDraft(
      finance,
      prepared.draft,
    );
    expect(res).toEqual({ ok: true, data: { id: SETTLEMENT } });
    expect(postDriverSettlementDifference).toHaveBeenCalledWith("u1", {
      id: SETTLEMENT,
      charged_to: "driver",
    });

    // Without hr:write the accept is refused even with a stored draft.
    const denied =
      await proposeDriverSettlementDifference.proposal?.executeDraft(
        { userId: "u1", access: resolveAccess(["finance"], ["hr:write"]) },
        prepared.draft,
      );
    expect(denied).toMatchObject({ ok: false });
    expect(postDriverSettlementDifference).toHaveBeenCalledTimes(1);
  });
});
