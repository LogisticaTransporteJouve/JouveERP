import { describe, expect, it } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import { canMoveStock, movesStock } from "./moves-stock";

const stored = {
  warehouse_id: "w1",
  status: "en_deposito",
  quantity: 10,
  entry_date: "2026-10-01",
  exit_date: null,
};

describe("movesStock", () => {
  it("is false when the edit sends every stock field unchanged", () => {
    expect(movesStock(stored, { ...stored })).toBe(false);
    expect(movesStock({ ...stored, quantity: null }, { quantity: null })).toBe(
      false,
    );
  });

  it("is false when the edit leaves the stock fields out", () => {
    expect(movesStock(stored, {})).toBe(false);
  });

  it("is true for a change of deposit, status, quantity, entry or exit", () => {
    expect(movesStock(stored, { warehouse_id: "w2" })).toBe(true);
    expect(movesStock(stored, { status: "despachado" })).toBe(true);
    expect(movesStock(stored, { quantity: 11 })).toBe(true);
    expect(movesStock(stored, { quantity: null })).toBe(true);
    expect(movesStock(stored, { entry_date: "2026-10-02" })).toBe(true);
    expect(movesStock(stored, { exit_date: "2026-11-01" })).toBe(true);
  });
});

describe("canMoveStock", () => {
  it("needs pallets:write and stock_movements:write", () => {
    expect(canMoveStock(resolveAccess(["warehouse"], []))).toBe(true);
    expect(
      canMoveStock(resolveAccess(["warehouse"], ["stock_movements:write"])),
    ).toBe(false);
    expect(canMoveStock(resolveAccess(["warehouse"], ["pallets:write"]))).toBe(
      false,
    );
  });
});
