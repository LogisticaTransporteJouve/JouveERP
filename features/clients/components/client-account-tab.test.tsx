// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const empty = {
  data: { movements: [], balances: { ARS: 0, USD: 0 }, runningBalance: true },
};
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/clients/c1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-url-period", () => ({
  useUrlPeriod: () => ({
    period: { kind: "all" },
    range: null,
    setPeriod: vi.fn(),
    reset: vi.fn(),
    isFiltered: false,
  }),
}));
vi.mock("@/hooks/use-realtime-invalidate", () => ({
  useRealtimeInvalidate: () => {},
}));
vi.mock("@/components/providers/scope-provider", () => ({
  usePageScope: () => "all",
}));
vi.mock("../hooks/use-clients", () => ({
  useClientAccount: () => empty,
  useClearClientOpeningBalance: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/suppliers/hooks/use-suppliers", () => ({
  useSupplierAccount: () => empty,
  useClearSupplierOpeningBalance: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/receipts/components/new-receipt-dialog", () => ({
  NewReceiptDialog: () => <button type="button">stub-recibo</button>,
}));
vi.mock(
  "@/features/payment-orders/components/new-payment-order-dialog",
  () => ({
    NewPaymentOrderDialog: () => <button type="button">stub-op</button>,
  }),
);
vi.mock("@/features/invoices/components/new-invoice-dialog", () => ({
  NewInvoiceDialog: () => null,
}));
vi.mock(
  "@/features/purchase-invoices/components/new-purchase-invoice-dialog",
  () => ({ NewPurchaseInvoiceDialog: () => null }),
);
vi.mock("@/features/invoices/components/pdf-viewer-dialog", () => ({
  PdfViewerDialog: () => null,
}));
vi.mock("./opening-balance-dialog", () => ({
  OpeningBalanceDialog: () => null,
}));
vi.mock("@/features/suppliers/components/opening-balance-dialog", () => ({
  SupplierOpeningBalanceDialog: () => null,
}));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));

const { ClientAccountTab } = await import("./client-account-tab");
const { SupplierAccountTab } =
  await import("@/features/suppliers/components/supplier-account-tab");

afterEach(cleanup);

const party = {
  id: "c1",
  legal_name: "ACME",
  display_name: null,
  cuit: "30712345678",
  iva_condition: null,
  is_fiscal: true,
};

describe("account tabs — the receipt and OP forms pick an account", () => {
  it.each([
    ["finance", resolveAccess(["finance"]), true],
    [
      "finance with accounts:read denied",
      resolveAccess(["finance"], ["accounts:read"]),
      false,
    ],
  ])("%s sees Nuevo recibo: %s", (_, access, visible) => {
    render(
      <ClientAccountTab
        clientId="c1"
        client={party}
        channels={[]}
        accounts={[]}
        actorAccess={access}
      />,
    );
    expect(screen.queryByText("stub-recibo") !== null).toBe(visible);
  });

  it.each([
    ["finance", resolveAccess(["finance"]), true],
    [
      "finance with accounts:read denied",
      resolveAccess(["finance"], ["accounts:read"]),
      false,
    ],
  ])("%s sees Nueva OP: %s", (_, access, visible) => {
    render(
      <SupplierAccountTab
        supplierId="s1"
        supplier={party}
        accounts={[]}
        actorAccess={access}
      />,
    );
    expect(screen.queryByText("stub-op") !== null).toBe(visible);
  });
});
