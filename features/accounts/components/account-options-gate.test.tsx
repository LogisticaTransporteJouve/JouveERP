// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionResult } from "@/lib/query/run-action";

import { accountsKeys } from "../lib/accounts-keys";
import type { Account } from "../schema";

const list = vi.fn<() => Promise<ActionResult<Account[]>>>();
vi.mock("../actions/accounts-actions", () => ({
  listAccountsAction: () => list(),
}));

const { AccountOptionsGate } = await import("./account-options-gate");

const caja = { id: "a1", name: "Caja" } as Account;

function renderGate(client: QueryClient) {
  render(
    <QueryClientProvider client={client}>
      <AccountOptionsGate>
        {(accounts) => (
          <form>
            <input aria-label="Importe" defaultValue="" />
            <p>{accounts.map((a) => a.name).join(",")}</p>
          </form>
        )}
      </AccountOptionsGate>
    </QueryClientProvider>,
  );
}

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

afterEach(() => {
  cleanup();
  list.mockReset();
});

describe("AccountOptionsGate", () => {
  it("a failed read says so and «Reintentar» reads again", async () => {
    list.mockResolvedValueOnce({
      ok: false,
      error: "No se pudieron listar las cuentas.",
    });
    renderGate(newClient());
    expect(
      await screen.findByText("No se pudieron listar las cuentas."),
    ).toBeTruthy();

    list.mockResolvedValueOnce({ ok: true, data: [caja] });
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByText("Caja")).toBeTruthy();
  });

  it("a failed background refetch keeps the filled form and its accounts", async () => {
    const client = newClient();
    list.mockResolvedValueOnce({ ok: true, data: [caja] });
    renderGate(client);
    expect(await screen.findByText("Caja")).toBeTruthy();
    const input = screen.getByLabelText("Importe");
    fireEvent.change(input, { target: { value: "1.500" } });

    list.mockResolvedValueOnce({ ok: false, error: "timeout" });
    await act(async () => {
      await client.refetchQueries({ queryKey: accountsKeys.list() });
      // Let the observers hear about it.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(client.getQueryState(accountsKeys.list())?.status).toBe("error");
    expect(screen.getByLabelText("Importe")).toBe(input);
    expect(screen.getByText("Caja")).toBeTruthy();
    expect(screen.queryByText("timeout")).toBeNull();
  });
});
