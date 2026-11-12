// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/transactions",
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ChannelBadge } from "./channel-badge";
import { ScopeProvider } from "./providers/scope-provider";

const CHANNELS = [
  {
    id: "jouve_fiscal",
    name: "Logística Jouve — Fiscal",
    is_fiscal: true,
    is_active: true,
  },
  {
    id: "dz_fiscal",
    name: "DZ Instalaciones",
    is_fiscal: true,
    is_active: true,
    is_segregated: true,
    short_label: "DZ",
  },
];

function renderBadge(channelId: string | null) {
  return render(
    <ScopeProvider channels={CHANNELS} initialFiscalFilter="fiscal">
      <span data-testid="row">
        Movimiento
        <ChannelBadge channelId={channelId} />
      </span>
    </ScopeProvider>,
  );
}

describe("ChannelBadge", () => {
  afterEach(cleanup);

  it("marca un movimiento de un canal segregado con su etiqueta corta", () => {
    renderBadge("dz_fiscal");
    expect(screen.getByText("DZ").textContent).toBe("DZ");
  });

  it("no marca un canal principal ni un movimiento sin canal", () => {
    renderBadge("jouve_fiscal");
    expect(screen.getByTestId("row").textContent).toBe("Movimiento");
  });

  it("fuera del layout no rompe ni marca", () => {
    render(<ChannelBadge channelId="dz_fiscal" />);
    expect(screen.queryByText("DZ")).toBeNull();
  });
});
