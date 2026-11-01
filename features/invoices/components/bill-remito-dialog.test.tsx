// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoicingChannelSummary } from "@/lib/scope";

type PosState = {
  data?: ReadonlyArray<{
    numero: number;
    channel_id: string;
    nickname: string | null;
  }>;
  isPending: boolean;
  isError: boolean;
};

const h = vi.hoisted(() => {
  const pos: PosState = { isPending: false, isError: false };
  return {
    pos,
    posCalls: [] as Array<{ channelId: string | null; enabled?: boolean }>,
    mutate: vi.fn(),
    billPending: false,
    push: vi.fn(),
    pickerIsFiscal: [] as boolean[],
    toast: { success: vi.fn(), error: vi.fn() },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/invoices/r1",
  useRouter: () => ({ refresh: vi.fn(), push: h.push }),
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("../hooks/use-invoices", () => ({
  useEnabledPos: (channelId: string | null, opts: { enabled?: boolean }) => {
    h.posCalls.push({ channelId, enabled: opts.enabled });
    return h.pos;
  },
  useBillRemito: () => ({ mutate: h.mutate, isPending: h.billPending }),
}));
vi.mock("./client-picker", () => ({
  ClientPicker: ({
    onChange,
    isFiscal,
  }: {
    onChange: (c: unknown) => void;
    isFiscal: boolean;
  }) => {
    h.pickerIsFiscal.push(isFiscal);
    return (
      <button
        type="button"
        onClick={() =>
          onChange({
            id: "client-1",
            legal_name: "ACME SA",
            display_name: null,
            cuit: "30712345678",
            iva_condition: "responsable_inscripto",
            is_fiscal: true,
          })
        }
      >
        pick-client
      </button>
    );
  },
}));

const { ScopeProvider } = await import("@/components/providers/scope-provider");
const { BillRemitoDialog } = await import("./bill-remito-dialog");

const FISCAL: InvoicingChannelSummary = {
  id: "jouve_fiscal",
  name: "Jouve",
  is_fiscal: true,
  is_active: true,
};
const INTERNAL: InvoicingChannelSummary = {
  id: "jouve_internal",
  name: "Interno",
  is_fiscal: false,
  is_active: true,
};

function setPos(state: PosState) {
  h.pos = state;
}

function open(channels: InvoicingChannelSummary[] = [FISCAL, INTERNAL]) {
  render(
    <ScopeProvider channels={channels} initialFiscalFilter="internal">
      <BillRemitoDialog
        remitoId="r1"
        remitoLabel="Remito X 9001-00000001"
        items={[{ quantity: 2, unit_price: 100 }]}
      />
    </ScopeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Facturar/ }));
}

function submitButton(): HTMLButtonElement {
  const el = screen.getByRole("button", { name: /Emitir factura|Emitiendo/ });
  if (!(el instanceof HTMLButtonElement)) throw new Error("not a button");
  return el;
}

beforeEach(() => {
  setPos({ isPending: false, isError: false, data: [] });
  h.posCalls = [];
  h.mutate.mockReset();
  h.billPending = false;
  h.push.mockReset();
  h.pickerIsFiscal = [];
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  // Radix Select needs these in jsdom.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

describe("BillRemitoDialog — point of sale", () => {
  it("takes the only enabled POS of the only active fiscal channel, from an Otras ventas page", () => {
    setPos({
      isPending: false,
      isError: false,
      data: [{ numero: 3, channel_id: "jouve_fiscal", nickname: null }],
    });
    open();
    expect(h.posCalls.at(-1)).toEqual({
      channelId: "jouve_fiscal",
      enabled: true,
    });
    expect(h.pickerIsFiscal.at(-1)).toBe(true);
    expect(screen.queryByLabelText("Punto de venta")).toBeNull();
    expect(submitButton().disabled).toBe(false);

    fireEvent.click(screen.getByText("pick-client"));
    fireEvent.click(submitButton());
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0]![0]).toMatchObject({
      remito_id: "r1",
      client_id: "client-1",
      channel_id: "jouve_fiscal",
      punto_venta: 3,
      iva_rate_id: 5,
    });
  });

  it("does not query POS while the dialog is closed", () => {
    render(
      <ScopeProvider channels={[FISCAL]} initialFiscalFilter="internal">
        <BillRemitoDialog remitoId="r1" remitoLabel="R" items={[]} />
      </ScopeProvider>,
    );
    expect(h.posCalls.at(-1)?.enabled).toBe(false);
  });

  it("several POS: a choice is required before submitting", () => {
    setPos({
      isPending: false,
      isError: false,
      data: [
        { numero: 3, channel_id: "jouve_fiscal", nickname: "Casa" },
        { numero: 7, channel_id: "jouve_fiscal", nickname: null },
      ],
    });
    open();
    fireEvent.click(screen.getByText("pick-client"));
    fireEvent.click(submitButton());
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalledWith("Elegí el punto de venta.");

    const trigger = screen.getByLabelText("Punto de venta");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: /0007/ }));
    fireEvent.click(submitButton());
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0]![0]).toMatchObject({ punto_venta: 7 });
  });

  it.each([
    ["loading", { isPending: true, isError: false }, null],
    [
      "error",
      { isPending: false, isError: true },
      "No se pudieron cargar los puntos de venta fiscales.",
    ],
    [
      "none enabled",
      { isPending: false, isError: false, data: [] },
      "No hay un punto de venta fiscal habilitado.",
    ],
  ] as const)("%s: submit is disabled", (_, state, message) => {
    setPos(state);
    open();
    expect(submitButton().disabled).toBe(true);
    if (message) expect(screen.getByText(message)).toBeTruthy();
  });

  it.each([
    ["no fiscal channel", [INTERNAL]],
    [
      "two active fiscal channels",
      [FISCAL, { ...FISCAL, id: "other_fiscal", name: "Otro" }, INTERNAL],
    ],
    ["an inactive fiscal channel", [{ ...FISCAL, is_active: false }, INTERNAL]],
  ])("%s: disabled with the channel message, no POS query", (_, channels) => {
    setPos({
      isPending: false,
      isError: false,
      data: [{ numero: 3, channel_id: "x", nickname: null }],
    });
    open(channels);
    expect(h.posCalls.at(-1)?.channelId).toBeNull();
    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText("Configurá un único canal fiscal activo para facturar."),
    ).toBeTruthy();
  });

  it("refuses without a client", () => {
    setPos({
      isPending: false,
      isError: false,
      data: [{ numero: 3, channel_id: "jouve_fiscal", nickname: null }],
    });
    open();
    fireEvent.click(submitButton());
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalledWith("Elegí el cliente de Ventas.");
  });
});

describe("BillRemitoDialog — idempotency key", () => {
  it("keeps the same key across a failed submit and the retry", () => {
    setPos({
      isPending: false,
      isError: false,
      data: [{ numero: 3, channel_id: "jouve_fiscal", nickname: null }],
    });
    h.mutate.mockImplementationOnce(
      (_input: unknown, cb: { onError: (e: Error) => void }) =>
        cb.onError(new Error("Sin respuesta")),
    );
    open();
    fireEvent.click(screen.getByText("pick-client"));
    fireEvent.click(submitButton());
    expect(h.toast.error).toHaveBeenCalledWith("Sin respuesta");
    // The dialog stays open for the retry.
    fireEvent.click(submitButton());

    expect(h.mutate).toHaveBeenCalledTimes(2);
    const first = h.mutate.mock.calls[0]![0].idempotency_key;
    const second = h.mutate.mock.calls[1]![0].idempotency_key;
    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it("on success closes and opens the factura", () => {
    setPos({
      isPending: false,
      isError: false,
      data: [{ numero: 3, channel_id: "jouve_fiscal", nickname: null }],
    });
    h.mutate.mockImplementationOnce(
      (_input: unknown, cb: { onSuccess: (d: { id: string }) => void }) =>
        cb.onSuccess({ id: "fac-1" }),
    );
    open();
    fireEvent.click(screen.getByText("pick-client"));
    fireEvent.click(submitButton());
    expect(h.push).toHaveBeenCalledWith("/invoices/fac-1");
    expect(screen.queryByRole("button", { name: /Emitir factura/ })).toBeNull();
  });

  it("while billing, submit and cancel are disabled", () => {
    setPos({
      isPending: false,
      isError: false,
      data: [{ numero: 3, channel_id: "jouve_fiscal", nickname: null }],
    });
    h.billPending = true;
    open();
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toContain("Emitiendo");
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    expect(cancel instanceof HTMLButtonElement && cancel.disabled).toBe(true);
  });
});
