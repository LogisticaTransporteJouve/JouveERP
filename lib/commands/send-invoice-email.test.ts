import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  filterValue,
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const FISCAL = "00000000-0000-4000-8000-0000000000f1";
const INTERNAL = "00000000-0000-4000-8000-0000000000e1";
const DRAFT = "00000000-0000-4000-8000-0000000000d1";

function respond(call: RecordedCall) {
  if (call.table !== "invoices") return { data: null, error: null };
  const id = filterValue(call, "eq", "id");
  return {
    data: {
      id,
      kind: "factura",
      letter: id === INTERNAL ? null : "A",
      punto_venta: 3,
      numero: id === DRAFT ? null : 12,
      fecha: "2026-11-02",
      imp_total: 1210,
      status: id === DRAFT ? "draft" : "emitted",
      channel: {
        name: id === INTERNAL ? "Interno" : "Fiscal",
        is_fiscal: id !== INTERNAL,
        business_unit: { name: "DZ & Sons S.A." },
      },
      client: { legal_name: "Cliente" },
    },
    error: null,
  };
}

let fake = recordingSupabase(respond);
const sendComprobanteByEmail = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/pdf/generate-and-hash", () => ({
  generateInvoicePdfBuffer: async () => ({ pdfBuffer: Buffer.from("pdf") }),
}));
vi.mock("@/lib/email/send-comprobante", () => ({
  sendComprobanteByEmail: (...args: unknown[]) =>
    sendComprobanteByEmail(...args),
}));

const { sendInvoiceEmail } = await import("./send-invoice-email");

const input = (invoice_id: string) => ({
  invoice_id,
  recipient: "pagos@cliente.com",
  subject: "Comprobante A0003-00000012",
  body: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  fake = recordingSupabase(respond);
  sendComprobanteByEmail.mockResolvedValue({
    ok: true,
    data: { log_id: "l1" },
  });
});

describe("sendInvoiceEmail", () => {
  it("sends an emitted comprobante under the issuer's name", async () => {
    const actor = { userId: "u1", access: resolveAccess(["finance"]) };
    expect(await sendInvoiceEmail(actor, input(FISCAL))).toEqual({
      ok: true,
      data: { log_id: "l1" },
    });
    expect(sendComprobanteByEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: "pagos@cliente.com",
        emisor_name: "DZ & Sons S.A.",
        internal: false,
        sent_by: "u1",
      }),
    );
  });

  it("refuses a comprobante that is not emitted yet", async () => {
    const actor = { userId: "u1", access: resolveAccess(["finance"]) };
    expect(await sendInvoiceEmail(actor, input(DRAFT))).toEqual({
      ok: false,
      error: "Solo se pueden enviar comprobantes en estado emitido.",
    });
    expect(sendComprobanteByEmail).not.toHaveBeenCalled();
  });

  it("a fiscal-only user cannot send an internal comprobante", async () => {
    const actor = { userId: "u1", access: resolveAccess(["fiscal_reader"]) };
    expect(await sendInvoiceEmail(actor, input(INTERNAL))).toEqual({
      ok: false,
      error: "Comprobante no encontrado.",
    });
    expect(sendComprobanteByEmail).not.toHaveBeenCalled();
  });
});
