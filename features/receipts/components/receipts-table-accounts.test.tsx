// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PAYMENT_ORDER_LIST_PARAMS } from "@/features/payment-orders/lib/payment-order-list-filters";
import { resolveAccess } from "@/lib/auth/permissions";

import { DEFAULT_RECEIPT_LIST_PARAMS } from "../lib/receipt-list-filters";

const h = vi.hoisted(() => ({ listAccounts: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/receipts",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-realtime-invalidate", () => ({
  useRealtimeInvalidate: () => {},
}));
vi.mock("@/components/providers/scope-provider", () => ({
  useScopeIsFiscal: () => null,
}));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction: h.listAccounts,
}));
const noRows = {
  items: [],
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
};
vi.mock("../hooks/use-receipts", () => ({
  useReceiptsSearchInfinite: () => noRows,
  useReceiptListTotals: () => ({ data: [] }),
}));
vi.mock("@/features/payment-orders/hooks/use-payment-orders", () => ({
  usePaymentOrdersSearchInfinite: () => noRows,
  usePaymentOrderListTotals: () => ({ data: [] }),
}));
vi.mock("./new-receipt-dialog", () => ({
  NewReceiptDialog: () => <button type="button">stub-nuevo-recibo</button>,
}));
vi.mock(
  "@/features/payment-orders/components/new-payment-order-dialog",
  () => ({
    NewPaymentOrderDialog: () => <button type="button">stub-nueva-op</button>,
  }),
);

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { ReceiptsTable } = await import("./receipts-table");
const { PaymentOrdersTable } =
  await import("@/features/payment-orders/components/payment-orders-table");

afterEach(() => {
  cleanup();
  h.listAccounts.mockReset();
});

function renderTables() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const access = resolveAccess(["finance"]);
  render(
    <QueryClientProvider client={client}>
      <ReceiptsTable
        channels={[]}
        actorAccess={access}
        initialParams={DEFAULT_RECEIPT_LIST_PARAMS}
      />
      <PaymentOrdersTable
        channels={[]}
        actorAccess={access}
        initialParams={DEFAULT_PAYMENT_ORDER_LIST_PARAMS}
      />
    </QueryClientProvider>,
  );
}

describe("Recibos and OP when the accounts read fails", () => {
  it("say so with a retry instead of an empty account picker", async () => {
    h.listAccounts.mockResolvedValue({
      ok: false,
      error: "No se pudieron listar las cuentas.",
    });
    renderTables();
    expect(
      await screen.findAllByText("No se pudieron listar las cuentas."),
    ).toHaveLength(2);
    expect(screen.queryByText("stub-nuevo-recibo")).toBeNull();
    expect(screen.queryByText("stub-nueva-op")).toBeNull();

    h.listAccounts.mockResolvedValue({ ok: true, data: [] });
    fireEvent.click(screen.getAllByRole("button", { name: /Reintentar/ })[0]!);
    expect(await screen.findByText("stub-nuevo-recibo")).toBeTruthy();
    expect(screen.getByText("stub-nueva-op")).toBeTruthy();
  });
});
