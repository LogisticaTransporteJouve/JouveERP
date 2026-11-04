// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { payrollKeys } from "../lib/payroll-keys";

vi.mock("../actions/payroll-actions", () => ({
  closePayrollPeriodAction: async () => ({
    ok: false,
    error: "El período ya estaba cerrado o no existe.",
  }),
  reopenPayrollPeriodAction: async () => ({
    ok: false,
    error: "El período ya estaba en borrador o no existe.",
  }),
}));

const { useClosePayrollPeriod, useReopenPayrollPeriod } =
  await import("./use-payroll");

describe("close and reopen refresh the period after a refusal", () => {
  it.each([
    ["close", useClosePayrollPeriod],
    ["reopen", useReopenPayrollPeriod],
  ] as const)(
    "%s refetches when another tab already moved it",
    async (_, hook) => {
      const qc = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });
      const spy = vi.spyOn(qc, "invalidateQueries");
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(() => hook(), { wrapper });
      result.current.mutate("00000000-0000-4000-8000-000000000001");
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(spy.mock.calls.map(([f]) => f?.queryKey)).toContainEqual(
        payrollKeys.all,
      );
    },
  );
});
