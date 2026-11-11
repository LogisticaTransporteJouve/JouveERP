// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A failed channel read in the layout is said as such, not left as empty
// selects and «Fiscal» labels.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/purchases",
  useRouter: () => ({ refresh }),
}));

const { ScopeProvider } = await import("./providers/scope-provider");
const { ChannelsReadError } = await import("./channels-read-error");

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

function renderWith(channelsFailed: boolean, inline = false) {
  render(
    <ScopeProvider
      channels={[]}
      channelsFailed={channelsFailed}
      initialFiscalFilter="fiscal"
    >
      <ChannelsReadError inline={inline} />
    </ScopeProvider>,
  );
}

describe("ChannelsReadError", () => {
  it("says the channels could not be read and retries the layout", () => {
    renderWith(true);
    expect(screen.getByRole("alert").textContent).toContain(
      "No se pudieron cargar los canales de facturación",
    );
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("has a short copy under a channel select", () => {
    renderWith(true, true);
    expect(screen.getByRole("alert").textContent).toContain(
      "No se pudieron cargar los canales.",
    );
  });

  it("shows nothing when the channels were read, even with none", () => {
    renderWith(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
