// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/lib/query/run-action";

const h = vi.hoisted(() => ({
  retry: vi.fn<(id: string) => Promise<ActionResult<void>>>(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: h.refresh }),
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("../actions/bill-remito-actions", () => ({
  retryRemitoCreditAction: h.retry,
}));

const { RetryRemitoCreditButton } =
  await import("./retry-remito-credit-button");

function button(): HTMLButtonElement {
  const el = screen.getByRole("button");
  if (!(el instanceof HTMLButtonElement)) throw new Error("not a button");
  return el;
}

beforeEach(() => {
  h.retry.mockReset();
  h.refresh.mockReset();
  h.toast.success.mockReset();
  h.toast.error.mockReset();
});
afterEach(cleanup);

describe("RetryRemitoCreditButton", () => {
  it("queues the settlement for this factura, toasts and refreshes", async () => {
    h.retry.mockResolvedValue({ ok: true, data: undefined });
    render(<RetryRemitoCreditButton facturaId="fac-1" />);
    fireEvent.click(button());

    await waitFor(() =>
      expect(h.toast.success).toHaveBeenCalledWith("Acreditación en cola."),
    );
    expect(h.retry).toHaveBeenCalledWith("fac-1");
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("shows the action's reason on ok:false, with no success toast or refresh", async () => {
    h.retry.mockResolvedValue({
      ok: false,
      error: "El remito tiene un recibo con cheques.",
    });
    render(<RetryRemitoCreditButton facturaId="fac-1" />);
    fireEvent.click(button());

    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith(
        "El remito tiene un recibo con cheques.",
      ),
    );
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });

  it("disables itself while the retry is in flight and re-enables after", async () => {
    let resolve!: (r: ActionResult<void>) => void;
    h.retry.mockReturnValue(
      new Promise<ActionResult<void>>((r) => {
        resolve = r;
      }),
    );
    render(<RetryRemitoCreditButton facturaId="fac-1" />);
    expect(button().textContent).toContain("Reintentar acreditación");
    fireEvent.click(button());

    await waitFor(() => expect(button().disabled).toBe(true));
    expect(button().textContent).toContain("Reintentando");
    fireEvent.click(button());
    expect(h.retry).toHaveBeenCalledTimes(1);

    await act(async () => resolve({ ok: true, data: undefined }));
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(button().textContent).toContain("Reintentar acreditación");
  });
});
