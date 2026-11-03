// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LateInterestBulkResult, LateInterestCandidate } from "../schema";

const results: LateInterestBulkResult[] = [
  { invoice_id: "inv-1", ok: true, nd_invoice_id: "nd-1" },
];

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-late-interest", () => ({
  useIssueLateInterestNdsBulk: () => ({
    isPending: false,
    mutate: (
      _input: unknown,
      opts: { onSuccess: (data: LateInterestBulkResult[]) => void },
    ) => opts.onSuccess(results),
  }),
}));

const { BulkLateInterestDialog } = await import("./bulk-late-interest-dialog");

const candidate: LateInterestCandidate = {
  invoice_id: "inv-1",
  client_id: "c1",
  client_name: "Cliente Mora",
  channel_id: "jouve_internal",
  channel_is_fiscal: false,
  kind: "factura",
  letter: null,
  punto_venta: 3,
  numero: 42,
  fecha: "2026-09-01",
  due_date: "2026-10-01",
  moneda: "PES",
  open_amount: 1000,
  charged_to: null,
  charge_from: "2026-10-02",
  client_rate: null,
  monthly_rate: 3,
  days: 30,
  balance_days: 30000,
  interest: 30,
};

afterEach(cleanup);

describe("BulkLateInterestDialog", () => {
  it("names each issued ND after the list refetch drops its comprobante", () => {
    const { rerender } = render(
      <BulkLateInterestDialog
        open
        candidates={[candidate]}
        asOf="2026-10-31"
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Emitir" }));
    // The hook's onSettled refetch: the charged comprobante has days = 0 now.
    rerender(
      <BulkLateInterestDialog
        open
        candidates={[]}
        asOf="2026-10-31"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Cliente Mora · FC 0003-00000042")).toBeTruthy();
    expect(screen.getByText("ND emitida.")).toBeTruthy();
  });
});
