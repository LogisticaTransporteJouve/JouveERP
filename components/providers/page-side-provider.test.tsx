// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoicingChannelSummary, ScopeSide } from "@/lib/scope";

const h = vi.hoisted(() => ({
  pathname: "/invoices",
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ refresh: h.refresh }),
}));

const {
  PageSideProvider,
  ScopeProvider,
  SideKeyed,
  useDefaultChannel,
  usePageIsFiscal,
  usePageScope,
  useScope,
  useScopeIsFiscal,
  useSideChannels,
} = await import("./scope-provider");

const CHANNELS: InvoicingChannelSummary[] = [
  { id: "jouve_fiscal", name: "Jouve", is_fiscal: true, is_active: true },
  { id: "jouve_internal", name: "Interno", is_fiscal: false, is_active: true },
];
const OPTIONS = [{ id: "jouve_fiscal" }, { id: "jouve_internal" }];

function wrapper({
  menu,
  locked = false,
  pinned,
}: {
  menu: ScopeSide;
  locked?: boolean;
  pinned?: ScopeSide;
}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ScopeProvider
        channels={CHANNELS}
        initialFiscalFilter={menu}
        locked={locked}
      >
        {pinned ? (
          <PageSideProvider side={pinned}>{children}</PageSideProvider>
        ) : (
          children
        )}
      </ScopeProvider>
    );
  };
}

function useAllSideHooks() {
  return {
    scope: usePageScope(),
    isFiscal: usePageIsFiscal(),
    readFilter: useScopeIsFiscal(),
    defaultChannel: useDefaultChannel(),
    options: useSideChannels(OPTIONS),
  };
}

beforeEach(() => {
  h.pathname = "/invoices";
  h.refresh.mockClear();
  window.localStorage.clear();
});
afterEach(cleanup);

describe("PageSideProvider precedence", () => {
  it("a pinned side beats the menu's side on a split page", () => {
    h.pathname = "/clients/abc";
    const { result } = renderHook(() => useAllSideHooks(), {
      wrapper: wrapper({ menu: "fiscal", pinned: "internal" }),
    });
    expect(result.current).toEqual({
      scope: "internal",
      isFiscal: false,
      readFilter: false,
      defaultChannel: "jouve_internal",
      options: [{ id: "jouve_internal" }],
    });
  });

  it("a pinned fiscal side beats an internal menu", () => {
    h.pathname = "/suppliers/abc";
    const { result } = renderHook(() => useAllSideHooks(), {
      wrapper: wrapper({ menu: "internal", pinned: "fiscal" }),
    });
    expect(result.current).toEqual({
      scope: "fiscal",
      isFiscal: true,
      readFilter: true,
      defaultChannel: "jouve_fiscal",
      options: [{ id: "jouve_fiscal" }],
    });
  });

  it("a pinned side beats the shared-page 'all' (AI document tray on any page)", () => {
    h.pathname = "/treasury";
    const { result } = renderHook(() => useAllSideHooks(), {
      wrapper: wrapper({ menu: "internal", pinned: "fiscal" }),
    });
    expect(result.current.scope).toBe("fiscal");
    expect(result.current.options).toEqual([{ id: "jouve_fiscal" }]);
    expect(result.current.defaultChannel).toBe("jouve_fiscal");
  });

  it("the innermost pin wins", () => {
    h.pathname = "/treasury";
    const { result } = renderHook(() => usePageScope(), {
      wrapper: ({ children }) => (
        <ScopeProvider channels={CHANNELS} initialFiscalFilter="fiscal">
          <PageSideProvider side="fiscal">
            <PageSideProvider side="internal">{children}</PageSideProvider>
          </PageSideProvider>
        </ScopeProvider>
      ),
    });
    expect(result.current).toBe("internal");
  });

  it("the pin holds after the menu switches side", () => {
    h.pathname = "/clients/abc";
    const { result } = renderHook(
      () => ({ scope: useScope(), page: usePageScope() }),
      { wrapper: wrapper({ menu: "fiscal", pinned: "internal" }) },
    );
    act(() => result.current.scope.setFiscalFilter("fiscal"));
    expect(result.current.page).toBe("internal");
    act(() => result.current.scope.setFiscalFilter("internal"));
    expect(result.current.page).toBe("internal");
  });
});

describe("locked beats pinned (fiscal-only user)", () => {
  it.each(["/clients/abc", "/treasury", "/invoices"])(
    "a pinned internal side still reads fiscal on %s",
    (path) => {
      h.pathname = path;
      const { result } = renderHook(() => useAllSideHooks(), {
        wrapper: wrapper({ menu: "fiscal", locked: true, pinned: "internal" }),
      });
      expect(result.current).toEqual({
        scope: "fiscal",
        isFiscal: true,
        readFilter: true,
        defaultChannel: "jouve_fiscal",
        options: [{ id: "jouve_fiscal" }],
      });
    },
  );

  it("a forged internal initial side with a pinned internal page stays fiscal", () => {
    h.pathname = "/clients/abc";
    const { result } = renderHook(() => useAllSideHooks(), {
      wrapper: wrapper({ menu: "internal", locked: true, pinned: "internal" }),
    });
    expect(result.current.scope).toBe("fiscal");
    expect(result.current.readFilter).toBe(true);
    expect(result.current.options).toEqual([{ id: "jouve_fiscal" }]);
  });
});

describe("SideKeyed", () => {
  let mounts = 0;
  function Counter() {
    const [n, setN] = useState(0);
    useEffect(() => {
      mounts += 1;
    }, []);
    return (
      <button type="button" onClick={() => setN((x) => x + 1)}>
        count {n}
      </button>
    );
  }
  function Switch() {
    const { setFiscalFilter } = useScope();
    return (
      <>
        <button type="button" onClick={() => setFiscalFilter("internal")}>
          to-internal
        </button>
        <button type="button" onClick={() => setFiscalFilter("fiscal")}>
          to-fiscal
        </button>
        <button
          type="button"
          onClick={() => setFiscalFilter("internal", { navigating: true })}
        >
          nav-internal
        </button>
      </>
    );
  }
  function Tree({ locked = false }: { locked?: boolean }) {
    return (
      <ScopeProvider
        channels={CHANNELS}
        initialFiscalFilter="fiscal"
        locked={locked}
      >
        <Switch />
        <SideKeyed>
          <Counter />
        </SideKeyed>
      </ScopeProvider>
    );
  }

  beforeEach(() => {
    mounts = 0;
  });

  it("remounts the page (dropping its state) when the side changes", () => {
    render(<Tree />);
    fireEvent.click(screen.getByText("count 0"));
    expect(screen.getByText("count 1")).toBeTruthy();
    expect(mounts).toBe(1);

    fireEvent.click(screen.getByText("to-internal"));
    expect(screen.getByText("count 0")).toBeTruthy();
    expect(mounts).toBe(2);
  });

  it("a navigating switch remounts under the new side", () => {
    render(<Tree />);
    fireEvent.click(screen.getByText("count 0"));
    expect(mounts).toBe(1);

    act(() => {
      fireEvent.click(screen.getByText("nav-internal"));
    });
    expect(screen.getByText("count 0")).toBeTruthy();
    expect(mounts).toBe(2);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the page mounted when the same side is chosen again", () => {
    render(<Tree />);
    fireEvent.click(screen.getByText("count 0"));
    fireEvent.click(screen.getByText("to-fiscal"));
    expect(screen.getByText("count 1")).toBeTruthy();
    expect(mounts).toBe(1);
  });

  it("a locked user never remounts (the side cannot change)", () => {
    render(<Tree locked />);
    fireEvent.click(screen.getByText("count 0"));
    fireEvent.click(screen.getByText("to-internal"));
    expect(screen.getByText("count 1")).toBeTruthy();
    expect(mounts).toBe(1);
    expect(h.refresh).not.toHaveBeenCalled();
  });
});
