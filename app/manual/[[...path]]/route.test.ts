import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Role } from "@/lib/auth/permissions";

const h = vi.hoisted(() => ({ roles: [] as string[], loggedIn: true }));

vi.mock("@/lib/auth/context", () => ({
  getCurrentUserContext: async () =>
    h.loggedIn
      ? { userId: "u1", access: resolveAccess(h.roles as Role[]) }
      : null,
}));

const { GET } = await import("./route");

function get(path: string[]) {
  return GET(new NextRequest(`http://localhost/manual/${path.join("/")}`), {
    params: Promise.resolve({ path }),
  });
}

beforeEach(() => {
  h.loggedIn = true;
});

describe("/manual access", () => {
  it("serves the guide to a role that sees the internal side", async () => {
    h.roles = ["finance"];
    const res = await get(["conceptos.html"]);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Conceptos generales");
  });

  it("refuses the external accountant: the guide documents the internal channel", async () => {
    h.roles = ["fiscal_reader"];
    for (const path of [["conceptos.html"], ["assets", "search-index.js"]]) {
      expect((await get(path)).status).toBe(403);
    }
  });

  it("does not exist for a user with no role", async () => {
    h.roles = [];
    expect((await get(["index.html"])).status).toBe(404);
  });

  it("sends a visitor to log in", async () => {
    h.loggedIn = false;
    const res = await get(["index.html"]);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login");
  });
});
