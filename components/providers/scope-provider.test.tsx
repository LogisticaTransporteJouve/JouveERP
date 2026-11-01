// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SCOPE_COOKIE,
  serializeFiscalFilter,
  type InvoicingChannelSummary,
  type ScopeSide,
} from "@/lib/scope";

const h = vi.hoisted(() => ({
  pathname: "/invoices",
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ refresh: h.refresh }),
}));

const {
  ScopeProvider,
  usePageIsFiscal,
  usePageScope,
  useScope,
  useSideChannels,
} = await import("./scope-provider");

const CHANNELS: InvoicingChannelSummary[] = [
  { id: "jouve_fiscal", name: "Jouve", is_fiscal: true, is_active: true },
  { id: "jouve_internal", name: "Interno", is_fiscal: false, is_active: true },
];

function wrapper({
  initial,
  locked = false,
}: {
  initial?: ScopeSide;
  locked?: boolean;
}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ScopeProvider
        channels={CHANNELS}
        initialFiscalFilter={initial}
        locked={locked}
      >
        {children}
      </ScopeProvider>
    );
  };
}

beforeEach(() => {
  h.pathname = "/invoices";
  h.refresh.mockClear();
  window.localStorage.clear();
  document.cookie = `${SCOPE_COOKIE}=; path=/; max-age=0`;
});
afterEach(cleanup);

describe("usePageScope", () => {
  it("follows the menu's side on a split page", () => {
    h.pathname = "/invoices/abc";
    const { result } = renderHook(() => usePageScope(), {
      wrapper: wrapper({ initial: "internal" }),
    });
    expect(result.current).toBe("internal");
  });

  it("reads every channel on a shared page, whatever the side", () => {
    h.pathname = "/treasury";
    const { result } = renderHook(() => usePageScope(), {
      wrapper: wrapper({ initial: "internal" }),
    });
    expect(result.current).toBe("all");
  });

  it("does not treat /aging-suppliers as a prefix of /aging", () => {
    h.pathname = "/aging-suppliers";
    const { result } = renderHook(() => usePageScope(), {
      wrapper: wrapper({ initial: "internal" }),
    });
    expect(result.current).toBe("internal");
  });

  it.each(["/invoices", "/treasury", "/dashboard"])(
    "a locked user is fiscal on %s",
    (path) => {
      h.pathname = path;
      const { result } = renderHook(() => usePageScope(), {
        wrapper: wrapper({ initial: "internal", locked: true }),
      });
      expect(result.current).toBe("fiscal");
    },
  );

  it("a locked user cannot switch side", () => {
    const { result } = renderHook(
      () => ({ scope: useScope(), page: usePageScope() }),
      { wrapper: wrapper({ initial: "fiscal", locked: true }) },
    );
    act(() => result.current.scope.setFiscalFilter("internal"));
    expect(result.current.scope.fiscalFilter).toBe("fiscal");
    expect(result.current.page).toBe("fiscal");
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("switching side writes the cookie before refreshing the server", () => {
    const { result } = renderHook(
      () => ({ scope: useScope(), page: usePageScope() }),
      { wrapper: wrapper({ initial: "fiscal" }) },
    );
    act(() => result.current.scope.setFiscalFilter("internal"));
    expect(result.current.page).toBe("internal");
    expect(document.cookie).toContain(
      `${SCOPE_COOKIE}=${encodeURIComponent(serializeFiscalFilter("internal"))}`,
    );
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("hydrates a legacy all from storage as fiscal", () => {
    window.localStorage.setItem("jouve_scope_v1", serializeFiscalFilter("all"));
    const { result } = renderHook(() => usePageScope(), {
      wrapper: wrapper({}),
    });
    expect(result.current).toBe("fiscal");
  });
});

describe("usePageIsFiscal / useSideChannels", () => {
  const options = [{ id: "jouve_fiscal" }, { id: "jouve_internal" }];

  it("keeps the internal channel alone on Otras ventas", () => {
    const { result } = renderHook(
      () => ({ isFiscal: usePageIsFiscal(), opts: useSideChannels(options) }),
      { wrapper: wrapper({ initial: "internal" }) },
    );
    expect(result.current.isFiscal).toBe(false);
    expect(result.current.opts).toEqual([{ id: "jouve_internal" }]);
  });

  it("keeps the fiscal channel alone on Ventas", () => {
    const { result } = renderHook(() => useSideChannels(options), {
      wrapper: wrapper({ initial: "fiscal" }),
    });
    expect(result.current).toEqual([{ id: "jouve_fiscal" }]);
  });

  it("offers every channel on a shared page", () => {
    h.pathname = "/transactions";
    const { result } = renderHook(
      () => ({ isFiscal: usePageIsFiscal(), opts: useSideChannels(options) }),
      { wrapper: wrapper({ initial: "internal" }) },
    );
    expect(result.current.isFiscal).toBeNull();
    expect(result.current.opts).toEqual(options);
  });

  it("a locked user gets only fiscal channels, even on a shared page", () => {
    h.pathname = "/transactions";
    const { result } = renderHook(() => useSideChannels(options), {
      wrapper: wrapper({ initial: "fiscal", locked: true }),
    });
    expect(result.current).toEqual([{ id: "jouve_fiscal" }]);
  });

  it("drops an unknown channel on a split page instead of guessing its side", () => {
    const { result } = renderHook(
      () => useSideChannels([...options, { id: "ghost" }]),
      { wrapper: wrapper({ initial: "fiscal" }) },
    );
    expect(result.current).toEqual([{ id: "jouve_fiscal" }]);
  });
});

describe("setFiscalFilter while navigating", () => {
  const cookieFor = (side: ScopeSide) =>
    `${SCOPE_COOKIE}=${encodeURIComponent(serializeFiscalFilter(side))}`;

  it("persists the cookie and storage before the state flips and the router cache is dropped", () => {
    const { result } = renderHook(() => useScope(), {
      wrapper: wrapper({ initial: "fiscal" }),
    });
    act(() => {
      result.current.setFiscalFilter("internal", { navigating: true });
      // Written synchronously, so the link's RSC request carries the new side.
      expect(document.cookie).toContain(cookieFor("internal"));
      expect(window.localStorage.getItem("jouve_scope_v1")).toBe(
        serializeFiscalFilter("internal"),
      );
    });
    expect(result.current.fiscalFilter).toBe("internal");
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("without navigating, writes cookie and storage first, then refreshes once", () => {
    const seenAtRefresh: string[] = [];
    h.refresh.mockImplementationOnce(() => {
      seenAtRefresh.push(document.cookie);
      seenAtRefresh.push(window.localStorage.getItem("jouve_scope_v1") ?? "");
    });
    const { result } = renderHook(() => useScope(), {
      wrapper: wrapper({ initial: "fiscal" }),
    });
    act(() => result.current.setFiscalFilter("internal"));
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(seenAtRefresh[0]).toContain(cookieFor("internal"));
    expect(seenAtRefresh[1]).toBe(serializeFiscalFilter("internal"));
    expect(result.current.fiscalFilter).toBe("internal");
  });

  it.each([{ navigating: true }, { navigating: false }, undefined])(
    "a locked user ignores the switch (%o): no write, no state, no refresh",
    (opts) => {
      const { result } = renderHook(() => useScope(), {
        wrapper: wrapper({ initial: "fiscal", locked: true }),
      });
      act(() => result.current.setFiscalFilter("internal", opts));
      expect(result.current.fiscalFilter).toBe("fiscal");
      expect(document.cookie).not.toContain(cookieFor("internal"));
      expect(window.localStorage.getItem("jouve_scope_v1")).not.toBe(
        serializeFiscalFilter("internal"),
      );
      expect(h.refresh).not.toHaveBeenCalled();
    },
  );
});
