import { describe, expect, it } from "vitest";

import { navItemForPath, navSectionForItem } from "./nav-items";

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
