// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import type { CheckListItem } from "../actions/checks-actions";

const h = vi.hoisted(() => ({ listAccounts: vi.fn() }));

const CHECK: CheckListItem = {
  id: "00000000-0000-4000-8000-000000000001",
  amount: 100_000,
  bank_name: "Banco Galicia",
  cartera_account_id: "00000000-0000-4000-8000-000000000003",
  cartera_account_name: "Cartera",
  channel_id: "ch1",
  check_number: "123",
  created_at: "2026-10-01T00:00:00Z",
  created_by: null,
  currency: "ARS",
  drawer_cuit: null,
  drawer_name: "Cliente SRL",
  due_date: "2026-12-01",
  issue_date: "2026-10-01",
  kind: "fisico",
  notes: null,
  source_client_id: null,
  source_client_legal_name: null,
  source_kind: "manual",
  source_payment_line_id: null,
  source_receipt_id: null,
  status: "en_cartera",
  updated_at: "2026-10-01T00:00:00Z",
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-realtime-invalidate", () => ({
  useRealtimeInvalidate: () => {},
}));
vi.mock("@/components/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/features/accounts/actions/accounts-actions", () => ({
  listAccountsAction: h.listAccounts,
}));
vi.mock("../hooks/use-checks", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useChecksList: () => ({ data: { items: [CHECK], truncated: false } }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { ChequesTable } = await import("./checks-table");

afterEach(() => {
  cleanup();
  h.listAccounts.mockReset();
});

function renderTable(denied: string[]) {
  h.listAccounts.mockResolvedValue(
    denied.includes("accounts:read")
      ? { ok: false, error: "No tenés permiso para ver cuentas." }
      : { ok: true, data: [] },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>
        <ChequesTable
          channels={[{ id: "ch1", name: "Jouve fiscal", is_active: true }]}
          actorAccess={resolveAccess(["finance"], denied)}
        />
      </Suspense>
    </QueryClientProvider>,
  );
}

describe("ChequesTable with accounts:read denied", () => {
  it("renders the cartera and hides what picks an account", () => {
    renderTable(["accounts:read"]);
    expect(screen.getByText("Banco Galicia")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Nuevo cheque/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Depositar/ })).toBeNull();
    expect(h.listAccounts).not.toHaveBeenCalled();
  });

  it("offers them when the user can read accounts", async () => {
    renderTable([]);
    expect(
      await screen.findByRole("button", { name: /Nuevo cheque/ }),
    ).toBeTruthy();
  });
});
