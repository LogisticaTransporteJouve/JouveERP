import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";
import {
  filterValue,
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const FISCAL = "00000000-0000-4000-8000-0000000000f1";
const INTERNAL = "00000000-0000-4000-8000-0000000000e1";

let roles: Role[] = ["fiscal_reader"];

function respond(call: RecordedCall) {
  if (call.table === "invoices") {
    const id = filterValue(call, "eq", "id");
    return {
      data: {
        kind: "factura",
        letter: id === FISCAL ? "A" : null,
        punto_venta: id === FISCAL ? 3 : 9001,
        numero: 12,
        notified_at: null,
        client: { legal_name: "Cliente", email: "cliente@example.com" },
        channel: { is_fiscal: id === FISCAL },
      },
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

const { getInvoiceEmailDefaultsAction } = await import("./send-invoice-email");

beforeEach(() => {
  roles = ["fiscal_reader"];
  fake = recordingSupabase(respond);
});

describe("getInvoiceEmailDefaultsAction", () => {
  it("refuses an id that is not a UUID without reading", async () => {
    expect((await getInvoiceEmailDefaultsAction("x")).ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("does not show a fiscal-only reader an internal comprobante's client", async () => {
    expect(await getInvoiceEmailDefaultsAction(INTERNAL)).toEqual({
      ok: false,
      error: "Comprobante no encontrado.",
    });
    const fiscal = await getInvoiceEmailDefaultsAction(FISCAL);
    expect(fiscal.ok && fiscal.data.recipient).toBe("cliente@example.com");
  });

  it("staff get an internal comprobante's defaults", async () => {
    roles = ["finance"];
    const res = await getInvoiceEmailDefaultsAction(INTERNAL);
    expect(res.ok && res.data.client_legal_name).toBe("Cliente");
  });
});
