// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IvaPositionEstimate, TaxDocument } from "../schema";

type EstimateCallbacks = {
  onSuccess: (result: IvaPositionEstimate) => void;
  onError: (err: Error) => void;
};

const h = vi.hoisted(() => ({
  calls: [] as Array<{ period: string; callbacks: EstimateCallbacks }>,
  reset: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/features/files/components/attachments-zone", () => ({
  AttachmentsZone: () => null,
}));
vi.mock("../hooks/use-tax-documents", () => ({
  useTaxAccountOptions: () => ({ data: [] }),
  useCreateTaxDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTaxDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useIvaEstimate: () => ({
    mutate: (period: string, callbacks: EstimateCallbacks) =>
      h.calls.push({ period, callbacks }),
    reset: h.reset,
    isPending: false,
  }),
}));

const { TaxDocumentDialog } = await import("./tax-document-dialog");

function ivaDoc(id: string, period: string): TaxDocument {
  return {
    id,
    kind: "iva",
    title: null,
    jurisdiction: null,
    period,
    due_date: "2026-11-18",
    amount: null,
    amount_is_estimate: false,
    status: "pendiente",
    account_id: null,
    account_name: null,
    payment_transaction_id: null,
    payment_origin: null,
    paid_date: null,
    paid_amount: null,
    paid_from: null,
    credit_balance: null,
    notes: null,
  };
}

function estimate(period: string, saldo: number): IvaPositionEstimate {
  return {
    period,
    debito: saldo,
    credito: 0,
    retenciones: 0,
    saldo_anterior: 0,
    saldo_anterior_known: true,
    saldo,
    tributos_compras: 0,
    ventas: 1,
    compras: 0,
  };
}

function amountInput(): HTMLInputElement {
  const el = screen.getByLabelText("Importe");
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

beforeEach(() => {
  h.calls.length = 0;
  h.reset.mockReset();
  h.toast.error.mockReset();
});
afterEach(cleanup);

describe("TaxDocumentDialog · Estimar", () => {
  it("fills the amount when the answer is for the open document", () => {
    render(
      <TaxDocumentDialog
        open
        onOpenChange={() => {}}
        doc={ivaDoc("t9", "2026-09")}
        canAttach={false}
        canEstimate
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Estimar/ }));
    act(() => h.calls[0]!.callbacks.onSuccess(estimate("2026-09", 500)));
    expect(amountInput().value).toBe("500");
  });

  it("drops a late answer once another document is open", () => {
    const { rerender } = render(
      <TaxDocumentDialog
        open
        onOpenChange={() => {}}
        doc={ivaDoc("t9", "2026-09")}
        canAttach={false}
        canEstimate
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Estimar/ }));
    rerender(
      <TaxDocumentDialog
        open
        onOpenChange={() => {}}
        doc={ivaDoc("t10", "2026-10")}
        canAttach={false}
        canEstimate
      />,
    );
    act(() => h.calls[0]!.callbacks.onSuccess(estimate("2026-09", 500)));
    expect(amountInput().value).toBe("");
    expect(screen.queryByText(/Posición estimada/)).toBeNull();
  });

  it("drops a late answer once the period changed", () => {
    render(
      <TaxDocumentDialog
        open
        onOpenChange={() => {}}
        doc={ivaDoc("t9", "2026-09")}
        canAttach={false}
        canEstimate
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Estimar/ }));
    fireEvent.change(screen.getByLabelText("Período"), {
      target: { value: "2026-10" },
    });
    act(() => h.calls[0]!.callbacks.onSuccess(estimate("2026-09", 500)));
    act(() => h.calls[0]!.callbacks.onError(new Error("tarde")));
    expect(amountInput().value).toBe("");
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("drops a late answer once the dialog was closed and reopened", () => {
    const doc = ivaDoc("t9", "2026-09");
    const { rerender } = render(
      <TaxDocumentDialog
        open
        onOpenChange={() => {}}
        doc={doc}
        canAttach={false}
        canEstimate
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Estimar/ }));
    for (const open of [false, true]) {
      rerender(
        <TaxDocumentDialog
          open={open}
          onOpenChange={() => {}}
          doc={doc}
          canAttach={false}
          canEstimate
        />,
      );
    }
    act(() => h.calls[0]!.callbacks.onSuccess(estimate("2026-09", 500)));
    expect(amountInput().value).toBe("");
    expect(h.reset).toHaveBeenCalled();
  });
});

describe("TaxDocumentDialog · Estimar gate", () => {
  it("hides Estimar without accounting:read", () => {
    render(
      <TaxDocumentDialog
        open
        onOpenChange={() => {}}
        doc={ivaDoc("t9", "2026-09")}
        canAttach={false}
        canEstimate={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /Estimar/ })).toBeNull();
  });
});
