// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// «Nuevo préstamo» picks its channel from the layout's scope, and says a
// failed read under the select instead of an empty «Canal».

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/loans",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/accounts/hooks/use-accounts", () => ({
  useAccountOptions: () => ({
    accounts: [],
    error: null,
    pending: false,
    retry: null,
  }),
}));
vi.mock("../hooks/use-loans", () => ({
  useCreateLoan: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Radix measures its controls; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { ScopeProvider } = await import("@/components/providers/scope-provider");
const { LoanDialog } = await import("./loan-dialog");

afterEach(cleanup);

const CHANNELS = [
  {
    id: "jouve_fiscal",
    name: "Logística Jouve",
    is_fiscal: true,
    is_active: true,
  },
  {
    id: "jouve_internal",
    name: "Logística Jouve (interno)",
    is_fiscal: false,
    is_active: true,
  },
];

function renderWith(channelsFailed: boolean, channels = CHANNELS) {
  render(
    <ScopeProvider
      channels={channels}
      channelsFailed={channelsFailed}
      initialFiscalFilter="fiscal"
    >
      <LoanDialog open onOpenChange={() => {}} />
    </ScopeProvider>,
  );
}

describe("LoanDialog channel read", () => {
  it("says the channels could not be read", () => {
    renderWith(true);
    expect(screen.getByRole("alert").textContent).toContain(
      "No se pudieron cargar los canales.",
    );
  });

  it("says nothing when the channels were read", () => {
    renderWith(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("LoanDialog channel and open-ended mode", () => {
  it("offers a channel select defaulting to the fiscal channel", () => {
    renderWith(false);
    expect(screen.getByRole("combobox", { name: "Canal" }).textContent).toBe(
      "Logística Jouve",
    );
  });

  it("«Sin vencimiento» asks the monthly interest instead of the plan", () => {
    renderWith(false);
    expect(screen.getByText("Plan de cuotas")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Sin vencimiento (solo interés)" }),
    );
    expect(screen.queryByText("Plan de cuotas")).toBeNull();
    expect(screen.getByLabelText("Interés mensual %")).toBeTruthy();
    expect(screen.getByText("Primer vencimiento")).toBeTruthy();
  });
});
