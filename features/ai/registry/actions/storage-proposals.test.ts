import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const getStorageBillingAction = vi.fn();
const searchClientsAction = vi.fn();
const listInvoicingChannelsAction = vi.fn();
const listEnabledPosAction = vi.fn();
const invoiceStorage = vi.fn();
const userDb = { kind: "user-client" };

vi.mock("@/features/storage-billing/actions/billing-actions", () => ({
  getStorageBillingAction,
}));
vi.mock("@/features/clients/actions/clients-actions", () => ({
  searchClientsAction,
}));
vi.mock("@/features/invoices/actions/invoices-actions", () => ({
  listInvoicingChannelsAction,
  listEnabledPosAction,
}));
vi.mock("@/lib/commands/invoice-storage", () => ({ invoiceStorage }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => userDb }));

const { proposeStorageInvoice } = await import("./storage-proposals");

const ctx = { userId: "u1", access: resolveAccess(["finance"]) };
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";

const line = (
  clientId: string,
  storage: number,
  handlingIn = 0,
  handlingOut = 0,
  missingRate = false,
) => ({
  pallet_id: `p-${clientId}-${storage}`,
  code: "P1",
  client_id: clientId,
  client_name: "Acme SA",
  days: 31,
  daily_rate: 1,
  storage_charge: storage,
  handling_in_charge: handlingIn,
  handling_out_charge: handlingOut,
  charge: storage + handlingIn + handlingOut,
  has_tariff: true,
  missing_rate: missingRate,
});

const october = {
  client: "Acme SA",
  period_start: "2026-10-01",
  period_end: "2026-10-31",
};

beforeEach(() => {
  vi.clearAllMocks();
  searchClientsAction.mockResolvedValue({
    ok: true,
    data: {
      clients: [
        { id: CLIENT, legal_name: "Acme SA", display_name: null, cuit: null },
      ],
    },
  });
  getStorageBillingAction.mockResolvedValue({
    ok: true,
    data: {
      lines: [
        line(CLIENT, 30_000.1, 5_000),
        line(CLIENT, 20_000.2, 0, 2_500),
        line(OTHER, 99_999),
      ],
      byClient: [
        {
          client_id: CLIENT,
          client_name: "Acme SA",
          client_is_fiscal: true,
          pallets: 2,
          charge: 57_500.3,
        },
      ],
    },
  });
  listInvoicingChannelsAction.mockResolvedValue({
    ok: true,
    data: [
      { id: "jouve_fiscal", name: "Jouve fiscal", is_fiscal: true },
      { id: "jouve_internal", name: "Jouve interno", is_fiscal: false },
    ],
  });
  listEnabledPosAction.mockResolvedValue({
    ok: true,
    data: [{ numero: 3, channel_id: "jouve_fiscal", nickname: null }],
  });
});

describe("proposeStorageInvoice", () => {
  it("drafts the client's own lines on its side's channel, at the server's total", async () => {
    const prepared = await proposeStorageInvoice.proposal?.prepareDraft(
      ctx,
      october,
    );
    if (prepared?.kind !== "draft") throw new Error("no draft");
    expect(prepared.draft).toEqual({
      client_id: CLIENT,
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      channel_id: "jouve_fiscal",
      punto_venta: 3,
      expected_total: 57_500.3,
    });
    expect(prepared.summary).toContainEqual({
      label: "Almacenaje",
      value: "$ 50.000,30",
    });
    expect(prepared.summary).toContainEqual({
      label: "Total neto",
      value: "$ 57.500,30",
    });
    expect(listEnabledPosAction).toHaveBeenCalledWith("jouve_fiscal");
  });

  it("accepting bills through the command with the user's client and the shown total", async () => {
    const prepared = await proposeStorageInvoice.proposal?.prepareDraft(
      ctx,
      october,
    );
    if (prepared?.kind !== "draft") throw new Error("no draft");
    invoiceStorage.mockResolvedValue({ ok: true, data: { invoiceId: "inv1" } });
    const res = await proposeStorageInvoice.proposal?.executeDraft(
      ctx,
      prepared.draft,
    );
    expect(res).toEqual({ ok: true, data: { id: "inv1" } });
    expect(invoiceStorage).toHaveBeenCalledWith(
      userDb,
      "u1",
      {
        client_id: CLIENT,
        period_start: "2026-10-01",
        period_end: "2026-10-31",
        channel_id: "jouve_fiscal",
        punto_venta: 3,
      },
      57_500.3,
    );
  });

  it("asks for the punto de venta when there is more than one", async () => {
    listEnabledPosAction.mockResolvedValue({
      ok: true,
      data: [
        { numero: 3, channel_id: "jouve_fiscal", nickname: null },
        { numero: 5, channel_id: "jouve_fiscal", nickname: "Depósito" },
      ],
    });
    const prepared = await proposeStorageInvoice.proposal?.prepareDraft(
      ctx,
      october,
    );
    expect(prepared).toMatchObject({
      kind: "issues",
      issues: [{ field: "punto_venta" }],
    });
  });

  it("refuses without pallets or with a USD tariff and no rate", async () => {
    getStorageBillingAction.mockResolvedValue({
      ok: true,
      data: { lines: [line(OTHER, 1)], byClient: [] },
    });
    expect(
      await proposeStorageInvoice.proposal?.prepareDraft(ctx, october),
    ).toMatchObject({ kind: "error" });

    getStorageBillingAction.mockResolvedValue({
      ok: true,
      data: {
        lines: [line(CLIENT, 0, 0, 0, true)],
        byClient: [
          {
            client_id: CLIENT,
            client_name: "Acme SA",
            client_is_fiscal: true,
            pallets: 1,
            charge: 0,
          },
        ],
      },
    });
    const noRate = await proposeStorageInvoice.proposal?.prepareDraft(
      ctx,
      october,
    );
    expect(noRate).toMatchObject({ kind: "error" });
    if (noRate?.kind === "error") {
      expect(noRate.error).toContain("cotización del dólar");
    }
    expect(invoiceStorage).not.toHaveBeenCalled();
  });
});
