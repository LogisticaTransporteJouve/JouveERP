// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getDefaults, sendInvoice } = vi.hoisted(() => ({
  getDefaults: vi.fn(),
  sendInvoice: vi.fn(),
}));

vi.mock("@/features/invoices/actions/send-invoice-email", () => ({
  getInvoiceEmailDefaultsAction: getDefaults,
  sendInvoiceByEmailAction: sendInvoice,
}));
vi.mock("@/features/receipts/actions/send-receipt-email", () => ({
  getReceiptEmailDefaultsAction: vi.fn(),
  sendReceiptByEmailAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SendByEmailDialog } from "./send-by-email-dialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SendByEmailDialog", () => {
  it("sends the suggested recipient and subject without editing them", async () => {
    getDefaults.mockResolvedValue({
      ok: true,
      data: {
        recipient: "cliente@ejemplo.com",
        subject: "Factura A 0001-00000001",
        last_sent_at: null,
      },
    });
    sendInvoice.mockResolvedValue({ ok: true, data: null });

    render(<SendByEmailDialog kind="invoice" id="inv-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar por email" }));

    const submit = await screen.findByRole("button", { name: "Enviar" });
    expect(submit).toHaveProperty("disabled", false);
    fireEvent.click(submit);

    await vi.waitFor(() =>
      expect(sendInvoice).toHaveBeenCalledWith({
        invoice_id: "inv-1",
        recipient: "cliente@ejemplo.com",
        subject: "Factura A 0001-00000001",
        body: undefined,
      }),
    );
  });

  it("keeps «Enviar» disabled while there is no recipient", async () => {
    getDefaults.mockResolvedValue({
      ok: true,
      data: { recipient: null, subject: "Factura", last_sent_at: null },
    });

    render(<SendByEmailDialog kind="invoice" id="inv-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar por email" }));

    expect(
      await screen.findByRole("button", { name: "Enviar" }),
    ).toHaveProperty("disabled", true);
  });
});
