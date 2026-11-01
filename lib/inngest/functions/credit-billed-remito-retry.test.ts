import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// A retry of credit-billed-remito re-issues the settlement NC under its own
// key (issue-invoice dedupes on idempotency_key for 24h, so reusing the first
// run's key would drop it), and two runs for one factura never overlap.

const FACTURA = "11111111-1111-4111-8111-111111111111";
const NC = "33333333-3333-4333-8333-333333333333";

function respond(call: RecordedCall): FakeResponse {
  if (call.op === "rpc") return { data: NC, error: null };
  return {
    data: {
      id: NC,
      status: "draft",
      channel_id: "jouve_internal",
      punto_venta: 9001,
      idempotency_key: FACTURA,
    },
    error: null,
  };
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));

const { creditBilledRemito } = await import("./credit-billed-remito");

const step = {
  run: async (_id: string, fn: () => Promise<unknown>) => fn(),
  sendEvent: vi.fn(async () => undefined),
};

function invoke(event: { id?: string; data: unknown }) {
  const handler = Reflect.get(Object(creditBilledRemito), "fn");
  if (typeof handler !== "function") throw new Error("no handler");
  return handler({ event, step });
}

function sentKey(callIndex: number): unknown {
  const call = step.sendEvent.mock.calls[callIndex] as unknown[] | undefined;
  const payload = call?.[1];
  if (typeof payload !== "object" || payload === null) return undefined;
  const data = Reflect.get(payload, "data");
  return typeof data === "object" && data !== null
    ? Reflect.get(data, "idempotency_key")
    : undefined;
}

beforeEach(() => {
  fake = recordingSupabase(respond);
  step.sendEvent.mockClear();
});

describe("creditBilledRemito — per-run issue key", () => {
  it("keys the NC issue by the NC's key and this run's event id", async () => {
    await invoke({ id: "evt-cae", data: { factura_id: FACTURA } });
    expect(sentKey(0)).toBe(`${FACTURA}:evt-cae`);
  });

  it("gives a retry a different key than the run before it", async () => {
    await invoke({ id: "evt-cae", data: { factura_id: FACTURA } });
    await invoke({ id: "evt-retry", data: { factura_id: FACTURA } });
    expect(step.sendEvent).toHaveBeenCalledTimes(2);
    expect(sentKey(0)).not.toBe(sentKey(1));
    expect(sentKey(1)).toBe(`${FACTURA}:evt-retry`);
  });
});

describe("creditBilledRemito — config", () => {
  it("runs one at a time per factura", () => {
    const opts = Reflect.get(Object(creditBilledRemito), "opts");
    expect(opts).toMatchObject({
      id: "credit-billed-remito",
      concurrency: { key: "event.data.factura_id", limit: 1 },
    });
  });

  it("listens to the remito-billed event only", () => {
    const opts = Reflect.get(Object(creditBilledRemito), "opts");
    expect(opts).toMatchObject({
      triggers: [{ event: "invoice/remito.billed" }],
    });
  });
});
