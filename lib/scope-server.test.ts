import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Access, resolveAccess } from "@/lib/auth/permissions";

import { SCOPE_COOKIE, serializeFiscalFilter } from "./scope";

const h = vi.hoisted(() => ({
  access: null as Access | null,
  cookie: undefined as string | undefined,
}));

vi.mock("@/lib/auth/context", () => ({
  getCurrentUserContext: async () =>
    h.access ? { userId: "u1", access: h.access } : null,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SCOPE_COOKIE && h.cookie !== undefined
        ? { name, value: h.cookie }
        : undefined,
  }),
}));

const { readScopeCookie, readSharedScope } = await import("./scope-server");

const asCookie = (filter: "all" | "fiscal" | "internal") =>
  encodeURIComponent(serializeFiscalFilter(filter));

beforeEach(() => {
  h.access = resolveAccess(["finance"]);
  h.cookie = undefined;
});

describe("readScopeCookie", () => {
  it("is fiscal without a cookie", async () => {
    expect(await readScopeCookie()).toBe("fiscal");
  });

  it("reads the side the menu wrote", async () => {
    h.cookie = asCookie("internal");
    expect(await readScopeCookie()).toBe("internal");
    h.cookie = asCookie("fiscal");
    expect(await readScopeCookie()).toBe("fiscal");
  });

  it("reads a legacy all cookie as fiscal", async () => {
    h.cookie = asCookie("all");
    expect(await readScopeCookie()).toBe("fiscal");
    h.cookie = encodeURIComponent(
      JSON.stringify({ division: "dz", fiscalFilter: "all" }),
    );
    expect(await readScopeCookie()).toBe("fiscal");
  });

  it("falls back to fiscal on a malformed cookie", async () => {
    h.cookie = "%E0%A4%A";
    expect(await readScopeCookie()).toBe("fiscal");
    h.cookie = "garbage";
    expect(await readScopeCookie()).toBe("fiscal");
  });

  it("pins a fiscal-only user to fiscal whatever the cookie says", async () => {
    h.access = resolveAccess(["fiscal_reader"]);
    h.cookie = asCookie("internal");
    expect(await readScopeCookie()).toBe("fiscal");
  });

  it("a fiscal_reader who also holds another role keeps the cookie", async () => {
    h.access = resolveAccess(["fiscal_reader", "finance"]);
    h.cookie = asCookie("internal");
    expect(await readScopeCookie()).toBe("internal");
  });
});

describe("readSharedScope", () => {
  it("reads every channel for a regular user, whatever the cookie", async () => {
    h.cookie = asCookie("internal");
    expect(await readSharedScope()).toBe("all");
  });

  it("stays fiscal for a fiscal-only user", async () => {
    h.access = resolveAccess(["fiscal_reader"]);
    expect(await readSharedScope()).toBe("fiscal");
  });

  it("without a session is all (the layout redirects before any read)", async () => {
    h.access = null;
    expect(await readSharedScope()).toBe("all");
  });
});
