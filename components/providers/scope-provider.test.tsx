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
  search: "",
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(h.search),
  usePathname: () => h.pathname,
  useRouter: () => ({ refresh: h.refresh }),
}));

const {
  PageChannelProvider,
  ScopeProvider,
  useChannelOptions,
  useDefaultChannel,
  usePageChannelScope,
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
  h.search = "";
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

describe("a segregated channel's section", () => {
  const ALL: InvoicingChannelSummary[] = [
    ...CHANNELS,
    {
      id: "dz_fiscal",
      name: "DZ Instalaciones",
      is_fiscal: true,
      is_active: true,
      is_segregated: true,
      short_label: "DZ",
    },
    {
      id: "dz_internal",
      name: "DZ Interno",
      is_fiscal: false,
      is_active: true,
      is_segregated: true,
    },
  ];
  function sectionWrapper({
    initial = "fiscal",
    locked = false,
    pinned = null,
  }: {
    initial?: ScopeSide;
    locked?: boolean;
    pinned?: string | null;
  }) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <ScopeProvider
          channels={ALL}
          initialFiscalFilter={initial}
          locked={locked}
        >
          <PageChannelProvider channelId={pinned}>
            {children}
          </PageChannelProvider>
        </ScopeProvider>
      );
    };
  }
  const useSection = () => ({
    channels: useScope().channels.map((c) => c.id),
    defaultChannel: useDefaultChannel(),
    scope: usePageChannelScope(),
  });

  it("without the param: main channels, default Jouve", () => {
    h.pathname = "/purchases";
    const { result } = renderHook(useSection, { wrapper: sectionWrapper({}) });
    expect(result.current.channels).toEqual(["jouve_fiscal", "jouve_internal"]);
    expect(result.current.defaultChannel).toBe("jouve_fiscal");
    expect(result.current.scope).toEqual({ isFiscal: true, channelId: null });
  });

  it("?channel=dz_fiscal on a split page: only DZ, default DZ, its side", () => {
    h.pathname = "/purchases";
    h.search = "channel=dz_fiscal";
    const { result } = renderHook(useSection, {
      wrapper: sectionWrapper({ initial: "internal" }),
    });
    expect(result.current.channels).toEqual(["dz_fiscal"]);
    expect(result.current.defaultChannel).toBe("dz_fiscal");
    expect(result.current.scope).toEqual({
      isFiscal: true,
      channelId: "dz_fiscal",
    });
  });

  it("the param on a shared page (treasury) opens nothing", () => {
    h.pathname = "/treasury";
    h.search = "channel=dz_fiscal";
    const { result } = renderHook(useSection, { wrapper: sectionWrapper({}) });
    expect(result.current.channels).toEqual(["jouve_fiscal", "jouve_internal"]);
    expect(result.current.scope.channelId).toBeNull();
  });

  it("a fiscal-only user opens a fiscal segregated channel, not an internal one", () => {
    h.pathname = "/purchases";
    h.search = "channel=dz_fiscal";
    const fiscal = renderHook(useSection, {
      wrapper: sectionWrapper({ locked: true }),
    });
    expect(fiscal.result.current.channels).toEqual(["dz_fiscal"]);
    cleanup();
    h.search = "channel=dz_internal";
    const internal = renderHook(useSection, {
      wrapper: sectionWrapper({ locked: true }),
    });
    expect(internal.result.current.scope.channelId).toBeNull();
  });

  it("a record page pins its channel; a form keeps a stored channel", () => {
    h.pathname = "/purchases/abc";
    const pinned = renderHook(useSection, {
      wrapper: sectionWrapper({ pinned: "dz_fiscal" }),
    });
    expect(pinned.result.current.channels).toEqual(["dz_fiscal"]);
    cleanup();
    const options = renderHook(() => useChannelOptions("dz_fiscal"), {
      wrapper: sectionWrapper({}),
    });
    expect(options.result.current.map((c) => c.id)).toEqual([
      "jouve_fiscal",
      "jouve_internal",
      "dz_fiscal",
    ]);
  });
});
