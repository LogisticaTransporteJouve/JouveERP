import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

let roles: Role[] = ["owner"];
let fake = recordingSupabase(respond);
// paginateRange reads until an empty page: each read answers once.
const served = new Set<string>();

function once(key: string, data: unknown) {
  if (served.has(key)) return { data: [], error: null };
  served.add(key);
  return { data, error: null };
}

function payloadClient(call: RecordedCall): string {
  const p = call.payload;
  return typeof p === "object" && p !== null && "p_client_id" in p
    ? String(p.p_client_id)
    : "";
}

function respond(call: RecordedCall) {
  if (call.table === "shipments") {
    return once("shipments", [
      { client_id: "c1", client: { legal_name: "Beta" } },
      { client_id: "c1", client: { legal_name: "Beta" } },
      { client_id: "c2", client: { legal_name: "Alfa" } },
    ]);
  }
  if (call.table === "freight_settlement_candidates") {
    const client = payloadClient(call);
    return once(
      `cand:${client}`,
      client === "c1"
        ? [
            { shipment_id: "s1", amount: 1000 },
            { shipment_id: "s2", amount: null },
          ]
        : [{ shipment_id: "s3", amount: null }],
    );
  }
  if (call.table === "save_freight_settlement") {
    return { data: "fs1", error: null };
  }
  if (call.table === "confirm_freight_settlement_document") {
    return {
      data: {
        channel: "fiscal",
        numero: null,
        remito_pos: 9002,
        remito_number: 4,
      },
      error: null,
    };
  }
  return { data: null, error: null };
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

const { createFreightSettlementsBulkAction } =
  await import("./bulk-freight-settlements");

const input = { period_start: "2026-10-01", period_end: "2026-10-31" };

beforeEach(() => {
  roles = ["owner"];
  served.clear();
  fake = recordingSupabase(respond);
});

describe("createFreightSettlementsBulkAction", () => {
  it("drafts one liquidación per client with its priced cargas", async () => {
    const res = await createFreightSettlementsBulkAction(input);
    expect(res).toEqual({
      ok: true,
      data: {
        created: [
          {
            id: "fs1",
            client_name: "Beta",
            cargas: 1,
            total: 1000,
            unpriced: 1,
            remito: null,
            confirm_error: null,
          },
        ],
        skipped: [
          {
            client_name: "Alfa",
            reason: "1 carga sin flete ni tarifa de flete.",
          },
        ],
      },
    });
    const saves = fake.calls.filter(
      (c) => c.table === "save_freight_settlement",
    );
    expect(saves).toHaveLength(1);
    expect(saves[0]?.payload).toMatchObject({
      p_client_id: "c1",
      p_shipment_ids: ["s1"],
      p_user_id: "u1",
    });
    expect(saves[0]?.payload).not.toHaveProperty("p_settlement_id");
  });

  it("confirms each one through the remito R path when asked", async () => {
    const res = await createFreightSettlementsBulkAction({
      ...input,
      confirm: true,
    });
    expect(res.ok && res.data.created[0]?.remito).toBe("R9002-00000004");
    const confirms = fake.calls.filter(
      (c) => c.table === "confirm_freight_settlement_document",
    );
    expect(confirms.map((c) => c.payload)).toEqual([
      { p_settlement_id: "fs1", p_user_id: "u1" },
    ]);
  });

  it("does not confirm unless asked", async () => {
    await createFreightSettlementsBulkAction(input);
    expect(
      fake.calls.some((c) => c.table === "confirm_freight_settlement_document"),
    ).toBe(false);
  });

  it("refuses an inverted period and needs invoices:issue", async () => {
    expect(
      (
        await createFreightSettlementsBulkAction({
          period_start: "2026-10-31",
          period_end: "2026-10-01",
        })
      ).ok,
    ).toBe(false);
    roles = ["operations"];
    expect((await createFreightSettlementsBulkAction(input)).ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});
