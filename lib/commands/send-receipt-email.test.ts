import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterValue,
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const ISSUED = "00000000-0000-4000-8000-0000000000a1";
const CANCELED = "00000000-0000-4000-8000-0000000000a2";

function respond(call: RecordedCall) {
  if (call.table !== "receipts") return { data: null, error: null };
  const id = filterValue(call, "eq", "id");
  return {
    data: { id, status: id === CANCELED ? "canceled" : "issued" },
    error: null,
  };
}

let fake = recordingSupabase(respond);
const sendComprobanteByEmail = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/pdf/receipt-render", () => ({
  buildReceiptTemplateData: async () => ({
    punto_venta: 2,
    numero: 41,
    fecha: "2026-11-05",
    total_amount: 100_000,
    emisor: { legal_name: "DZ & Sons S.A." },
    receptor: { legal_name: "Cliente Uno SA" },
  }),
  renderReceiptPdf: async () => Buffer.from("pdf"),
}));
vi.mock("@/lib/email/send-comprobante", () => ({
  sendComprobanteByEmail: (...args: unknown[]) =>
    sendComprobanteByEmail(...args),
}));

const { sendReceiptEmail } = await import("./send-receipt-email");

const input = (receipt_id: string) => ({
  receipt_id,
  recipient: "pagos@cliente.com",
  subject: "Recibo X0002-00000041",
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

describe("sendReceiptEmail", () => {
  it("sends an issued receipt's PDF, logged as the actor", async () => {
    expect(await sendReceiptEmail("u1", input(ISSUED))).toEqual({
      ok: true,
      data: { log_id: "l1" },
    });
    expect(sendComprobanteByEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: "receipt",
        entity_id: ISSUED,
        recipient: "pagos@cliente.com",
        emisor_name: "DZ & Sons S.A.",
        client_legal_name: "Cliente Uno SA",
        sent_by: "u1",
      }),
    );
  });

  it("refuses a receipt that is not issued", async () => {
    expect(await sendReceiptEmail("u1", input(CANCELED))).toEqual({
      ok: false,
      error: "Solo se pueden enviar recibos emitidos.",
    });
    expect(sendComprobanteByEmail).not.toHaveBeenCalled();
  });
});
