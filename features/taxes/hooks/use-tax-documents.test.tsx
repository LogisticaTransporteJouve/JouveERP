// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { reconciliationKeys } from "@/features/bank-reconciliation/lib/reconciliation-keys";
import { managementKeys } from "@/features/management/lib/management-keys";

import { taxesKeys } from "../lib/taxes-keys";

vi.mock("../actions/tax-documents-actions", () => ({
  payTaxDocumentAction: async () => ({
    ok: false,
    error: "No se pudo registrar el pago.",
  }),
}));
vi.mock("../actions/tax-payment-link-actions", () => ({}));

const { usePayTaxDocument } = await import("./use-tax-documents");

describe("tax mutations", () => {
  it("refresh Gestión and Conciliación, also when the request fails", async () => {
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => usePayTaxDocument(), { wrapper });
    result.current.mutate({});
    await waitFor(() => expect(result.current.isError).toBe(true));
    const keys = spy.mock.calls.map(([f]) => f?.queryKey);
    expect(keys).toContainEqual(taxesKeys.all);
    expect(keys).toContainEqual(managementKeys.all);
    expect(keys).toContainEqual(reconciliationKeys.all);
  });
});
