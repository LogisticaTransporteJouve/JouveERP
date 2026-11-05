// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoicingChannelSummary } from "@/lib/scope";

// «Crear factura» from a scan says a failed puntos-de-venta read, instead of
// «Sin POS habilitado», which claims a configuration problem.

const h = vi.hoisted(() => ({ pos: {} as Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/documents",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/invoices/hooks/use-invoices", () => ({
  useEnabledPos: () => h.pos,
}));
vi.mock("../hooks/use-documents", () => ({
  useCreateSalesInvoiceFromExtraction: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

const { ScopeProvider } = await import("@/components/providers/scope-provider");
const { CreateSalesInvoiceDialog } =
  await import("./create-sales-invoice-dialog");

const FISCAL: InvoicingChannelSummary = {
  id: "jouve_fiscal",
  name: "Jouve",
  is_fiscal: true,
  is_active: true,
};

function renderDialog() {
  render(
    <ScopeProvider channels={[FISCAL]} initialFiscalFilter="fiscal">
      <CreateSalesInvoiceDialog
        extractionId="ex-1"
        payload={null}
        clientName={null}
        duplicate="none"
        open
        onOpenChange={() => {}}
        onCreated={() => {}}
      />
    </ScopeProvider>,
  );
}

beforeEach(() => {
  h.pos = { data: [], isSuccess: true, isError: false, refetch: vi.fn() };
});
afterEach(cleanup);

describe("CreateSalesInvoiceDialog puntos de venta read", () => {
  it("says a failed read and retries it", () => {
    const refetch = vi.fn();
    h.pos = { data: undefined, isSuccess: false, isError: true, refetch };
    renderDialog();
    expect(
      screen.getByText("No se pudieron cargar los puntos de venta."),
    ).toBeTruthy();
    expect(screen.queryByText("Sin POS habilitado")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("says «Sin POS habilitado» only for a channel read with none", () => {
    renderDialog();
    expect(screen.getByText("Sin POS habilitado")).toBeTruthy();
    expect(
      screen.queryByText("No se pudieron cargar los puntos de venta."),
    ).toBeNull();
  });
});
