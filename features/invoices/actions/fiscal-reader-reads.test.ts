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
  readFails: false,
}));

let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  if (call.table === "invoices" && call.filters.some(([, c]) => c === "id")) {
    return h.readFails
      ? { data: null, error: { message: "timeout" } }
      : { data: h.invoice, error: null };
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
  h.readFails = false;
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

  it("leaves a finance user's Todos scope on every side, without segregated channels", async () => {
    h.access = resolveAccess(["finance"]);
    await listInvoicesAction({ isFiscal: null });
    expect(scopeFilters()).toEqual([
      ["eq", "channel.is_segregated", false],
      ["not", "channel", ["is", null]],
    ]);
  });
});

describe.each([
  ["getInvoiceDetailAction", getInvoiceDetailAction, { ok: true, data: null }],
  [
    "getInvoiceStatusAction",
    getInvoiceStatusAction,
    { ok: false, error: `Comprobante ${ID} no encontrado.` },
  ],
] as const)("%s for a fiscal_reader", (_name, read, notFound) => {
  it("does not find an internal invoice", async () => {
    h.invoice = invoiceOn(false);
    expect(await read(ID)).toEqual(notFound);
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

describe("getInvoiceDetailAction tells a failed read from a missing one", () => {
  it("a missing comprobante is data null, so the page says not found", async () => {
    h.access = resolveAccess(["finance"]);
    expect(await getInvoiceDetailAction(ID)).toEqual({ ok: true, data: null });
  });

  it("a failed read is an error, so the page offers «Reintentar»", async () => {
    h.access = resolveAccess(["finance"]);
    h.readFails = true;
    expect(await getInvoiceDetailAction(ID)).toEqual({
      ok: false,
      error: "No se pudo cargar el comprobante.",
    });
  });
});
