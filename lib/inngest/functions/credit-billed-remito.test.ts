import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const h = vi.hoisted(() => ({
  settle: { data: null as unknown, error: null as unknown },
  nc: null as Record<string, unknown> | null,
}));

function respond(call: RecordedCall): FakeResponse {
  if (call.op === "rpc") {
    return { data: h.settle.data, error: h.settle.error };
  }
  if (call.table === "invoices") {
    return { data: h.nc, error: h.nc ? null : { message: "no rows" } };
  }
  return { data: null, error: null };
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));

const { creditBilledRemito } = await import("./credit-billed-remito");

const FACTURA = "11111111-1111-4111-8111-111111111111";
const NC = "33333333-3333-4333-8333-333333333333";

const step = {
  run: async (_id: string, fn: () => Promise<unknown>) => fn(),
  sendEvent: vi.fn(async () => undefined),
};

function invoke(data: unknown) {
  const handler = Reflect.get(Object(creditBilledRemito), "fn");
  if (typeof handler !== "function") throw new Error("no handler");
  return handler({ event: { data }, step });
}

beforeEach(() => {
  fake = recordingSupabase(respond);
  step.sendEvent.mockClear();
  h.settle = { data: NC, error: null };
  h.nc = {
    id: NC,
    status: "draft",
    channel_id: "jouve_internal",
    punto_venta: 9001,
    idempotency_key: FACTURA,
  };
});

describe("creditBilledRemito job", () => {
  it("settles in the DB and issues the NC it drafted on the internal side", async () => {
    await expect(invoke({ factura_id: FACTURA })).resolves.toEqual({
      nc_id: NC,
    });

    const rpc = fake.calls.find((c) => c.op === "rpc");
    expect(rpc?.table).toBe("settle_billed_remito");
    expect(step.sendEvent).toHaveBeenCalledWith("issue-remito-nc", {
      name: "invoice/issue.requested",
      data: {
        invoice_id: NC,
        idempotency_key: FACTURA,
        channel_id: "jouve_internal",
        punto_venta: 9001,
      },
    });
  });

  it("sends nothing when the remito had nothing left open", async () => {
    h.settle = { data: null, error: null };
    await expect(invoke({ factura_id: FACTURA })).resolves.toEqual({
      nc_id: null,
    });
    expect(step.sendEvent).not.toHaveBeenCalled();
  });

  it("does not resend an NC that already left draft", async () => {
    h.nc = { ...h.nc, status: "emitted" };
    await invoke({ factura_id: FACTURA });
    expect(step.sendEvent).not.toHaveBeenCalled();
  });

  it("gives up at once on a guard refusal, retries any other error", async () => {
    h.settle = {
      data: null,
      error: { message: "El remito se cobró con cheques", hint: "jouve_guard" },
    };
    await expect(invoke({ factura_id: FACTURA })).rejects.toBeInstanceOf(
      NonRetriableError,
    );

    h.settle = { data: null, error: { message: "timeout", hint: null } };
    const err = await invoke({ factura_id: FACTURA }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NonRetriableError);
  });

  it("rejects an event without a factura id", async () => {
    await expect(invoke({})).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });
});
