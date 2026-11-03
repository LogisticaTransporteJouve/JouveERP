// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { invoicesKeys } from "@/features/invoices/lib/invoices-keys";

vi.mock("../actions/late-interest-actions", () => ({
  getLateInterestGeneralRateAction: vi.fn(),
  issueLateInterestNdAction: vi.fn(async () => ({
    ok: false,
    error: "La nota de débito se emitió pero no se vinculó al comprobante.",
  })),
  issueLateInterestNdsBulkAction: vi.fn(),
  listLateInterestCandidatesAction: vi.fn(),
  setClientLateInterestRateAction: vi.fn(),
  setLateInterestGeneralRateAction: vi.fn(),
}));

const { useIssueLateInterestNd } = await import("./use-late-interest");

describe("useIssueLateInterestNd", () => {
  it("refreshes the lists even when the action fails after issuing", async () => {
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useIssueLateInterestNd(), {
      wrapper,
    });

    result.current.mutate({
      invoice_id: "00000000-0000-4000-8000-000000000001",
      as_of: "2026-11-03",
      monthly_rate: 3,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: invoicesKeys.all });
  });
});
