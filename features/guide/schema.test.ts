import { describe, expect, it } from "vitest";

import { NAV_SECTIONS } from "@/components/layout/nav-items";
import { ROLES, resolveAccess, userCanAll } from "@/lib/auth/permissions";

import { guideForPath, ROUTE_GUIDES } from "./lib/route-guides";
import { SETUP_ITEMS, SETUP_ITEM_KEYS } from "./lib/setup-checklist";
import { itemState, nextDismissed, SetGuideItemDoneSchema } from "./schema";

describe("guideForPath", () => {
  it("picks the deepest guide of the path", () => {
    expect(guideForPath("/suppliers/categories")?.title).toBe(
      "Categorías de proveedores",
    );
    expect(guideForPath("/suppliers/123")?.title).toBe("Proveedores");
    expect(guideForPath("/accounts/123")?.title).toBe("Cuentas");
    expect(guideForPath("/taxes")?.title).toBe("Impuestos");
    expect(guideForPath("/aging/mora")?.title).toBe("Intereses por mora");
    expect(guideForPath("/aging")?.title).toBe("Aging clientes");
  });

  it("does not match a sibling sharing a prefix", () => {
    expect(guideForPath("/aging-suppliers")?.title).toBe("Aging proveedores");
  });

  it("has nothing for an unknown route", () => {
    expect(guideForPath("/nope")).toBeUndefined();
  });

  it("every menu entry has its help", () => {
    const missing = NAV_SECTIONS.flatMap((s) => s.items)
      .map((item) => item.href)
      .filter((href) => guideForPath(href) === undefined);
    expect(missing).toEqual([]);
  });

  it("every prefix is unique", () => {
    const prefixes = ROUTE_GUIDES.map((g) => g.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe("setup checklist", () => {
  it("lists each key once, in the declared order", () => {
    expect(SETUP_ITEMS.map((i) => i.key)).toEqual([...SETUP_ITEM_KEYS]);
  });

  it("each item links to a page in the menu", () => {
    const hrefs = new Set(
      NAV_SECTIONS.flatMap((s) => s.items).map((i) => i.href),
    );
    for (const item of SETUP_ITEMS) expect(hrefs).toContain(item.href);
  });

  it("an item follows its module: hidden by role and by a per-user deny", () => {
    const taxes = SETUP_ITEMS.find((i) => i.key === "taxes")!;
    expect(userCanAll(resolveAccess(["finance"]), taxes.permission)).toBe(true);
    expect(
      userCanAll(resolveAccess(["finance"], ["taxes:read"]), taxes.permission),
    ).toBe(false);
    expect(userCanAll(resolveAccess(["operations"]), taxes.permission)).toBe(
      false,
    );
  });

  it("a driver sees no checklist; the owner sees all of it", () => {
    const visible = (role: (typeof ROLES)[number]) =>
      SETUP_ITEMS.filter((i) =>
        userCanAll(resolveAccess([role]), i.permission),
      );
    expect(visible("driver")).toEqual([]);
    expect(visible("owner")).toHaveLength(SETUP_ITEMS.length);
  });
});

describe("dismissed items", () => {
  it("adds once, removes, and drops unknown keys", () => {
    expect(nextDismissed([], "users", true)).toEqual(["users"]);
    expect(nextDismissed(["users"], "users", true)).toEqual(["users"]);
    expect(nextDismissed(["users", "gone"], "users", false)).toEqual([]);
    expect(nextDismissed(["gone", "taxes"], "users", true)).toEqual([
      "taxes",
      "users",
    ]);
  });

  it("data wins over the user's mark", () => {
    expect(itemState(true, ["users"], "users")).toBe("done_data");
    expect(itemState(false, ["users"], "users")).toBe("done_user");
    expect(itemState(false, [], "users")).toBe("pending");
  });

  it("only known keys are accepted", () => {
    expect(
      SetGuideItemDoneSchema.safeParse({ key: "users", done: true }).success,
    ).toBe(true);
    expect(
      SetGuideItemDoneSchema.safeParse({ key: "nope", done: true }).success,
    ).toBe(false);
  });
});
