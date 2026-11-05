// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Client } from "../schema";

const mutate = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-clients", () => ({
  useSetClientActive: () => ({ mutate, isPending: false }),
}));

const { ReactivateClientButton } = await import("./reactivate-client-button");

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

// The button reads only these fields.
const client = {
  id: "c1",
  legal_name: "Acme S.A.",
  is_active: false,
} satisfies Partial<Client> as Client;

describe("ReactivateClientButton", () => {
  it("sets the client active again", () => {
    render(<ReactivateClientButton client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Reactivar" }));
    expect(mutate).toHaveBeenCalledWith(
      { id: "c1", is_active: true },
      expect.anything(),
    );
  });
});
