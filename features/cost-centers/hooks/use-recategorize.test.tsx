// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { managementKeys } from "@/features/management/lib/management-keys";
import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";

vi.mock("../actions/recategorize-actions", () => ({
  recategorizeExpenseAction: async () => ({ ok: true, data: undefined }),
}));

const { useRecategorizeExpense } = await import("./use-recategorize");

describe("useRecategorizeExpense", () => {
  it("refreshes the books and Gestión, not only the source list", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRecategorizeExpense(), {
      wrapper,
    });
    result.current.mutate({
      source: "transactions",
      id: "00000000-0000-4000-8000-000000000001",
      expense_account_id: "00000000-0000-4000-8000-000000000002",
      cost_center_id: null,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = spy.mock.calls.map(([f]) => f?.queryKey);
    expect(keys).toContainEqual(transactionsKeys.all);
    expect(keys).toContainEqual(managementKeys.all);
    for (const key of LEDGER_KEYS) expect(keys).toContainEqual(key);
  });
});
