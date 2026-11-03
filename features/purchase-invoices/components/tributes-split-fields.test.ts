import { describe, expect, it } from "vitest";

import {
  tributesRemaining,
  tributesRemainingMessage,
} from "./tributes-split-fields";

describe("tributesRemaining", () => {
  it("is what is left of the total after the parts", () => {
    expect(tributesRemaining(10, ["3", "2", "", undefined])).toBe(5);
    expect(tributesRemaining(10, ["3", "7", "0", "0"])).toBe(0);
    expect(tributesRemaining(10, ["8", "4", "0", "0"])).toBe(-2);
  });
});

describe("tributesRemainingMessage", () => {
  it("says how much is missing or how much the parts went over", () => {
    expect(tributesRemainingMessage(5)).toBe("Falta repartir $ 5,00.");
    expect(tributesRemainingMessage(-2)).toBe("Te pasaste por $ 2,00.");
    expect(tributesRemainingMessage(0)).toBeNull();
  });
});
