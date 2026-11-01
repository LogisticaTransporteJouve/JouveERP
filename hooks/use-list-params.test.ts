// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useListParams } from "./use-list-params";

type Params = { query: string; status: string | null; group: string | null };

const DEFAULTS: Params = { query: "", status: null, group: "day" };
const toUrl = (p: Params) => ({
  q: p.query.trim() || null,
  status: p.status,
  group: p.group === "day" ? null : p.group,
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("useListParams", () => {
  it("mirrors the filters into the URL without navigating", () => {
    const { result } = renderHook(() =>
      useListParams({ initial: DEFAULTS, defaults: DEFAULTS, toUrl }),
    );
    act(() => result.current.update({ status: "emitted" }));
    expect(window.location.search).toBe("?status=emitted");
    expect(result.current.isFiltered).toBe(true);
  });

  it("debounces the search box before committing it", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useListParams({ initial: DEFAULTS, defaults: DEFAULTS, toUrl }),
    );
    act(() => result.current.update({ query: "acme" }));
    expect(result.current.params.query).toBe("acme");
    expect(result.current.committed.query).toBe("");
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.committed.query).toBe("acme");
  });

  it("clears every filter but keeps the view keys", () => {
    const { result } = renderHook(() =>
      useListParams({
        initial: { query: "x", status: "emitted", group: "week" },
        defaults: DEFAULTS,
        toUrl,
        viewKeys: ["group"],
      }),
    );
    expect(result.current.isFiltered).toBe(true);
    act(() => result.current.reset());
    expect(result.current.params).toEqual({
      query: "",
      status: null,
      group: "week",
    });
    expect(result.current.isFiltered).toBe(false);
  });

  it("does not count a view change as a filter", () => {
    const { result } = renderHook(() =>
      useListParams({
        initial: DEFAULTS,
        defaults: DEFAULTS,
        toUrl,
        viewKeys: ["group"],
      }),
    );
    act(() => result.current.update({ group: "month" }));
    expect(result.current.isFiltered).toBe(false);
  });
});
