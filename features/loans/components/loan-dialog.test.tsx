// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

const { ScopeProvider } = await import("@/components/providers/scope-provider");
const { LoanDialog } = await import("./loan-dialog");

afterEach(cleanup);

function renderWith(channelsFailed: boolean) {
  render(
    <ScopeProvider
      channels={[]}
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
