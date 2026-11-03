// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Pallet } from "../schema";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-pallets", () => ({
  useBlockPallet: () => ({ mutate: vi.fn(), isPending: false }),
  useUnblockPallet: () => ({ mutate: vi.fn(), isPending: false }),
  usePalletBlockEvents: () => ({
    isLoading: false,
    isError: false,
    data: [
      {
        id: "e1",
        action: "blocked",
        created_at: "2026-11-03T13:05:00Z",
        actor_name: "Ana",
        reason: "Dañado",
      },
    ],
  }),
}));

const pallet: Pallet = {
  id: "p1",
  warehouse_id: "w1",
  client_id: "c1",
  product_id: null,
  code: "P-001",
  quantity: 1,
  status: "en_deposito",
  entry_date: "2026-10-01",
  exit_date: null,
  notes: null,
  area_id: null,
  lot_number: null,
  lot_expiry: null,
  blocked_at: null,
  blocked_by: null,
  block_reason: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  warehouse: null,
  client: null,
  product: null,
  area: null,
};

const { BlockPalletDialog } = await import("./block-pallet-dialog");

afterEach(cleanup);

describe("BlockPalletDialog history", () => {
  it("shows block times in Argentina's time zone, not the browser's", () => {
    render(
      <BlockPalletDialog
        pallet={pallet}
        mode="block"
        open
        onOpenChange={() => undefined}
      />,
    );
    // 13:05 UTC is 10:05 in Buenos Aires.
    const item = screen.getByText("Dañado", { exact: false });
    expect(item.textContent).toContain("el 3 nov 2026, 10:05");
  });
});
