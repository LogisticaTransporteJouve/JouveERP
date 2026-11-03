// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { freightSettlementsKeys } from "@/features/freight-settlements/lib/freight-settlements-keys";
import { shipmentsKeys } from "@/features/shipments/lib/shipments-keys";
import { storageBillingKeys } from "@/features/storage-billing/lib/storage-billing-keys";

import { invoicesKeys } from "./invoices-keys";

// Each invoicing action returns { ok: false } after the factura was issued
// but not linked: the server changed, so the lists must refresh anyway.
const issuedButNotLinked = async () => ({
  ok: false as const,
  error: "La factura se emitió pero no se vinculó.",
});

vi.mock("@/features/shipments/actions/shipments-actions", () => ({
  invoiceFreightAction: issuedButNotLinked,
}));
vi.mock("@/features/shipments/actions/freight-tariff-actions", () => ({}));
vi.mock(
  "@/features/freight-settlements/actions/freight-settlements-actions",
  () => ({ invoiceFreightSettlementAction: issuedButNotLinked }),
);
vi.mock("@/features/invoices/actions/invoices-actions", () => ({}));
vi.mock("@/features/storage-billing/actions/billing-actions", () => ({
  invoiceStorageAction: issuedButNotLinked,
}));

const { useInvoiceFreight } =
  await import("@/features/shipments/hooks/use-shipments");
const { useInvoiceFreightSettlement } =
  await import("@/features/freight-settlements/hooks/use-freight-settlements");
const { useInvoiceStorage } =
  await import("@/features/storage-billing/hooks/use-storage-billing");

const input = {
  id: "00000000-0000-4000-8000-000000000001",
  channel_id: "jouve_fiscal",
  punto_venta: 3,
};

function setup() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const keys = () => spy.mock.calls.map(([filters]) => filters?.queryKey);
  return { wrapper, keys };
}

describe("invoicing hooks refresh on 'issued but not linked'", () => {
  it("useInvoiceFreight", async () => {
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useInvoiceFreight(), { wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(keys()).toContainEqual(invoicesKeys.all);
    expect(keys()).toContainEqual(shipmentsKeys.all);
  });

  it("useInvoiceFreightSettlement", async () => {
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useInvoiceFreightSettlement(), {
      wrapper,
    });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(keys()).toContainEqual(invoicesKeys.all);
    expect(keys()).toContainEqual(freightSettlementsKeys.all);
  });

  it("useInvoiceStorage", async () => {
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useInvoiceStorage(), { wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(keys()).toContainEqual(invoicesKeys.all);
    expect(keys()).toContainEqual(storageBillingKeys.all);
  });
});
