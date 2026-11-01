import { describe, expect, it } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import { isScopedPath } from "@/lib/scope";

import {
  canSee,
  NAV_SECTIONS,
  navItemForPath,
  navSectionForItem,
  visibleSections,
} from "./nav-items";

describe("navItemForPath", () => {
  it("picks the deepest matching item", () => {
    expect(navItemForPath("/suppliers/categories")?.label).toBe("Categorías");
    expect(navItemForPath("/suppliers/123")?.label).toBe("Proveedores");
    expect(navItemForPath("/ai/tasks")?.label).toBe("Tareas IA");
    expect(navItemForPath("/ai")?.label).toBe("Asistente");
  });

  it("does not match a sibling path sharing a prefix", () => {
    expect(navItemForPath("/aging-suppliers")?.label).toBe("Aging proveedores");
  });

  it("resolves a sales page to the current scope's section", () => {
    const fiscal = navItemForPath("/invoices/abc", "fiscal")!;
    const internal = navItemForPath("/invoices/abc", "internal")!;
    expect(navSectionForItem(fiscal)?.label).toBe("Ventas");
    expect(navSectionForItem(internal)?.label).toBe("Otras ventas");
    expect(navSectionForItem(navItemForPath("/aging")!)?.label).toBe("Ventas");
    expect(
      navSectionForItem(navItemForPath("/purchases", "internal")!)?.label,
    ).toBe("Otras compras");
  });

  it("returns undefined for unknown routes", () => {
    expect(navItemForPath("/nope")).toBeUndefined();
  });
});

describe("navSectionForItem", () => {
  it("finds the section of a nav item, none for the assistant", () => {
    const categories = navItemForPath("/suppliers/categories")!;
    expect(navSectionForItem(categories)?.label).toBe("Compras");
    expect(navSectionForItem(navItemForPath("/ai")!)).toBeUndefined();
  });
});

describe("navItemForPath with an href listed under both sides", () => {
  it.each([
    ["/clients/abc", "Clientes", "Clientes"],
    ["/invoices", "Comprobantes", "Remitos internos"],
    ["/receipts", "Recibos", "Recibos internos"],
    ["/aging", "Aging clientes", "Aging clientes"],
    ["/suppliers/categories", "Categorías", "Categorías"],
    ["/purchases/x", "Compras", "Remitos de compra"],
    ["/payment-orders/x", "Órdenes de pago", "Órdenes de pago"],
    ["/aging-suppliers", "Aging proveedores", "Aging proveedores"],
  ])(
    "%s resolves to the item of the asked side",
    (path, label, internalLabel) => {
      const fiscal = navItemForPath(path, "fiscal");
      const internal = navItemForPath(path, "internal");
      expect(fiscal?.label).toBe(label);
      expect(internal?.label).toBe(internalLabel);
      expect(fiscal?.scope).toBe("fiscal");
      expect(internal?.scope).toBe("internal");
    },
  );

  it("a shared page ignores the side", () => {
    expect(navItemForPath("/treasury", "internal")?.label).toBe("Resumen");
    expect(navItemForPath("/treasury", "internal")?.scope).toBeUndefined();
  });
});

describe("nav sides agree with isScopedPath", () => {
  const items = NAV_SECTIONS.flatMap((section) => section.items);

  it.each(items.map((item) => [item.href, item] as const))(
    "%s is split by side exactly when the menu lists it per side",
    (href, item) => {
      expect(isScopedPath(href)).toBe(item.scope !== undefined);
    },
  );
});

describe("canSee / visibleSections for a fiscal-only user", () => {
  const reader = resolveAccess(["fiscal_reader"]);

  it("hides every Otras ventas / Otras compras item", () => {
    const labels = visibleSections(reader).map((s) => s.label);
    expect(labels).not.toContain("Otras ventas");
    expect(labels).not.toContain("Otras compras");
    for (const item of NAV_SECTIONS.flatMap((s) => s.items)) {
      if (item.scope === "internal") expect(canSee(reader, item)).toBe(false);
    }
  });

  it("still shows the fiscal sides it may read", () => {
    const labels = visibleSections(reader).map((s) => s.label);
    expect(labels).toContain("Ventas");
    expect(labels).toContain("Compras");
  });

  it("a fiscal_reader with another role sees the internal sides", () => {
    const labels = visibleSections(
      resolveAccess(["fiscal_reader", "finance"]),
    ).map((s) => s.label);
    expect(labels).toContain("Otras ventas");
    expect(labels).toContain("Otras compras");
  });

  it("finance sees both sides", () => {
    const labels = visibleSections(resolveAccess(["finance"])).map(
      (s) => s.label,
    );
    expect(labels).toEqual(
      expect.arrayContaining([
        "Ventas",
        "Otras ventas",
        "Compras",
        "Otras compras",
      ]),
    );
  });
});
