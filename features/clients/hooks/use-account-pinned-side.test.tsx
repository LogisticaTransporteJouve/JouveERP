// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PageSideProvider,
  ScopeProvider,
} from "@/components/providers/scope-provider";
import { clientsKeys } from "@/features/clients/lib/clients-keys";
import { suppliersKeys } from "@/features/suppliers/lib/suppliers-keys";
import type { InvoicingChannelSummary, ScopeSide } from "@/lib/scope";

const h = vi.hoisted(() => ({
  pathname: "/clients/c1",
  getClientAccountAction: vi.fn(),
  getSupplierAccountAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/features/clients/actions/account-actions", () => ({
  getClientAccountAction: h.getClientAccountAction,
  getClientOpeningBalanceAction: vi.fn(),
  setClientOpeningBalanceAction: vi.fn(),
  clearClientOpeningBalanceAction: vi.fn(),
}));
vi.mock("@/features/clients/actions/clients-actions", () => ({}));
vi.mock("@/features/suppliers/actions/account-actions", () => ({
  getSupplierAccountAction: h.getSupplierAccountAction,
  getSupplierAgingAction: vi.fn(),
  getSupplierOpeningBalanceAction: vi.fn(),
  setSupplierOpeningBalanceAction: vi.fn(),
  clearSupplierOpeningBalanceAction: vi.fn(),
}));
vi.mock("@/features/suppliers/actions/suppliers-actions", () => ({}));

const { useClientAccount } = await import("./use-clients");
const { useSupplierAccount } =
  await import("@/features/suppliers/hooks/use-suppliers");

const CHANNELS: InvoicingChannelSummary[] = [
  { id: "jouve_fiscal", name: "Jouve", is_fiscal: true, is_active: true },
  { id: "jouve_internal", name: "Interno", is_fiscal: false, is_active: true },
];

let qc: QueryClient;

function wrapper({
  menu,
  pinned,
  locked = false,
}: {
  menu: ScopeSide;
  pinned: ScopeSide;
  locked?: boolean;
}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ScopeProvider
          channels={CHANNELS}
          initialFiscalFilter={menu}
          locked={locked}
        >
          <PageSideProvider side={pinned}>
            <Suspense fallback={null}>{children}</Suspense>
          </PageSideProvider>
        </ScopeProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  h.getClientAccountAction.mockReset();
  h.getSupplierAccountAction.mockReset();
  h.getClientAccountAction.mockResolvedValue({ ok: true, data: "fetched" });
  h.getSupplierAccountAction.mockResolvedValue({ ok: true, data: "fetched" });
});
afterEach(() => {
  cleanup();
  qc.clear();
});

// The detail page prefetches under the record's own is_fiscal and pins the
// page to that side; the hook must read the same cache slot, whatever side the
// menu last chose, so the hydrated data is used and nothing refetches.
describe.each([
  {
    name: "client",
    path: "/clients/c1",
    key: (isFiscal: boolean) => clientsKeys.accountByScope("c1", isFiscal),
    useHook: () => useClientAccount("c1"),
    action: () => h.getClientAccountAction,
  },
  {
    name: "supplier",
    path: "/suppliers/c1",
    key: (isFiscal: boolean) => suppliersKeys.accountByScope("c1", isFiscal),
    useHook: () => useSupplierAccount("c1"),
    action: () => h.getSupplierAccountAction,
  },
])("$name account under a pinned side", ({ path, key, useHook, action }) => {
  beforeEach(() => {
    h.pathname = path;
  });

  it.each([
    { menu: "fiscal", recordIsFiscal: false },
    { menu: "internal", recordIsFiscal: true },
    { menu: "fiscal", recordIsFiscal: true },
    { menu: "internal", recordIsFiscal: false },
  ] as const)(
    "menu $menu, record is_fiscal=$recordIsFiscal reads the prefetched slot",
    async ({ menu, recordIsFiscal }) => {
      qc.setQueryData(key(recordIsFiscal), "prefetched");
      const { result } = renderHook(() => useHook(), {
        wrapper: wrapper({
          menu,
          pinned: recordIsFiscal ? "fiscal" : "internal",
        }),
      });
      await waitFor(() => expect(result.current?.data).toBe("prefetched"));
      expect(action()).not.toHaveBeenCalled();
    },
  );

  it("a fiscal-only user never asks for the internal side, even pinned internal", async () => {
    const { result } = renderHook(() => useHook(), {
      wrapper: wrapper({ menu: "fiscal", pinned: "internal", locked: true }),
    });
    await waitFor(() => expect(result.current?.data).toBe("fetched"));
    expect(action()).toHaveBeenCalledTimes(1);
    expect(action()).toHaveBeenCalledWith("c1", { isFiscal: true });
    expect(qc.getQueryData(key(false))).toBeUndefined();
  });
});
