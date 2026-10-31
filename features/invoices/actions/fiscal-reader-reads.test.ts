import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Access, resolveAccess } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// The invoice reads go through the service client, so RLS does not reach
// them: a fiscal_reader is pinned to fiscal channels in the action itself.

const h = vi.hoisted(() => ({
  access: null as Access | null,
  invoice: null as Record<string, unknown> | null,
}));

let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.table === "invoices" && call.filters.some(([, c]) => c === "id")) {
    return { data: h.invoice, error: null };
  }
  return { data: [], error: null };
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn() } }));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { getInvoiceDetailAction, getInvoiceStatusAction, listInvoicesAction } =
  await import("./invoices-actions");

const ID = "11111111-1111-4111-8111-111111111111";

function invoiceOn(isFiscal: boolean) {
  return {
    id: ID,
    status: "emitted",
    kind: "factura",
    letter: isFiscal ? "A" : null,
    imp_total: 121,
    channel: { id: "c", name: "Canal", is_fiscal: isFiscal },
    client: {
      id: "cl",
      legal_name: "Cliente",
      iva_condition: "consumidor_final",
    },
    items: [],
  };
}

function scopeFilters() {
  const call = fake.calls.find((c) => c.table === "invoices");
  return (call?.filters ?? []).filter(([, column]) =>
    column.startsWith("channel"),
  );
}

beforeEach(() => {
  fake = recordingSupabase(respond);
  h.access = resolveAccess(["fiscal_reader"]);
  h.invoice = null;
});

describe("listInvoicesAction for a fiscal_reader", () => {
  it.each([null, false, undefined])(
    "asked for %s, still reads fiscal channels only",
    async (isFiscal) => {
      await listInvoicesAction({ isFiscal });
      expect(scopeFilters()).toEqual(
        expect.arrayContaining([
          ["eq", "channel.is_fiscal", true],
          ["not", "channel", ["is", null]],
        ]),
      );
    },
  );

  it("leaves a finance user's Todos scope untouched", async () => {
    h.access = resolveAccess(["finance"]);
    await listInvoicesAction({ isFiscal: null });
    expect(scopeFilters()).toEqual([]);
  });
});

describe.each([
  ["getInvoiceDetailAction", getInvoiceDetailAction],
  ["getInvoiceStatusAction", getInvoiceStatusAction],
] as const)("%s for a fiscal_reader", (_name, read) => {
  it("does not find an internal invoice", async () => {
    h.invoice = invoiceOn(false);
    const result = await read(ID);
    expect(result).toEqual({
      ok: false,
      error: `Comprobante ${ID} no encontrado.`,
    });
  });

  it("reads a fiscal invoice", async () => {
    h.invoice = invoiceOn(true);
    expect((await read(ID)).ok).toBe(true);
  });

  it("a finance user still reads an internal invoice", async () => {
    h.access = resolveAccess(["finance"]);
    h.invoice = invoiceOn(false);
    expect((await read(ID)).ok).toBe(true);
  });
});
