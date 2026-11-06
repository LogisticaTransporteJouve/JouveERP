import { beforeEach, describe, expect, it, vi } from "vitest";

import { describeAuditEvent } from "./describe";

const INVOICE = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const TRIP = "33333333-3333-4333-8333-333333333333";
const VEHICLE = "44444444-4444-4444-8444-444444444444";
const GONE = "55555555-5555-4555-8555-555555555555";

type Call = { table: string; method: string; args: unknown[] };
let calls: Call[] = [];
let tables: Record<string, unknown[]> = {};

function builder(table: string): unknown {
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: tables[table] ?? [], error: null }).then(
              resolve,
            );
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: String(prop), args });
          return chain;
        };
      },
    },
  );
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from: (table: string) => builder(table) }),
}));

const { collectEntityIds, resolveAuditEntities } =
  await import("./resolve-entities");

beforeEach(() => {
  calls = [];
  tables = {};
});

const issued = (id: string) => ({
  event_type: "invoice.issue_requested",
  target_resource_id: id,
  target_user_id: null,
  payload: { kind: "factura", client_id: CLIENT, imp_total: 1210 },
});

describe("collectEntityIds", () => {
  it("takes the target by the action's kind and the ids in the payload", () => {
    const wanted = collectEntityIds([
      issued(INVOICE),
      issued(INVOICE),
      {
        event_type: "trip.created",
        target_resource_id: TRIP,
        target_user_id: null,
        payload: { trip_date: "2026-11-07" },
      },
      // not a uuid: never sent to a uuid column
      {
        event_type: "afip.pos_configured",
        target_resource_id: "3",
        target_user_id: null,
        payload: {},
      },
    ]);
    expect([...(wanted.get("invoice") ?? [])]).toEqual([INVOICE]);
    expect([...(wanted.get("client") ?? [])]).toEqual([CLIENT]);
    expect([...(wanted.get("trip") ?? [])]).toEqual([TRIP]);
    expect(wanted.size).toBe(3);
  });
});

describe("resolveAuditEntities", () => {
  it("names a page of events with one query per kind, then their parties", async () => {
    tables = {
      invoices: [
        {
          id: INVOICE,
          kind: "factura",
          letter: "A",
          punto_venta: 3,
          numero: 22312,
          client_id: CLIENT,
          imp_total: 1234567,
          moneda: "PES",
        },
      ],
      clients: [{ id: CLIENT, legal_name: "TRANSPORTES SUR SA" }],
      trips: [
        {
          id: TRIP,
          trip_date: "2026-11-07",
          vehicle_id: VEHICLE,
          driver_id: null,
        },
      ],
      vehicles: [{ id: VEHICLE, patente: "AE463UF" }],
    };
    const events = [
      ...Array.from({ length: 30 }, () => issued(INVOICE)),
      {
        event_type: "trip.created",
        target_resource_id: TRIP,
        target_user_id: null,
        payload: { trip_date: "2026-11-07" },
      },
      issued(GONE),
    ];
    const lookup = await resolveAuditEntities(events);

    const queried = calls.filter((c) => c.method === "in").map((c) => c.table);
    expect(queried.sort()).toEqual([
      "clients",
      "invoices",
      "trips",
      "vehicles",
    ]);

    expect(describeAuditEvent(events[0]!, lookup)).toEqual({
      sentence:
        "emitió la Factura A 0003-00022312 a TRANSPORTES SUR SA por $ 1.234.567,00",
      subject: {
        label: "Factura A 0003-00022312 · TRANSPORTES SUR SA",
        href: `/invoices/${INVOICE}`,
      },
      group: "invoices",
    });
    expect(describeAuditEvent(events[30]!, lookup).sentence).toBe(
      "programó el viaje del 07/11/2026 con AE463UF",
    );
    // A deleted invoice falls back to the payload and links the client.
    expect(describeAuditEvent(events[31]!, lookup)).toEqual({
      sentence: "emitió la factura a TRANSPORTES SUR SA por $ 1.210,00",
      subject: { label: "TRANSPORTES SUR SA", href: `/clients/${CLIENT}` },
      group: "invoices",
    });
  });

  it("reads nothing for events that name no record", async () => {
    await resolveAuditEntities([
      {
        event_type: "late_interest.general_rate_set",
        target_resource_id: null,
        target_user_id: null,
        payload: { monthly_rate: 3 },
      },
    ]);
    expect(calls).toEqual([]);
  });
});
