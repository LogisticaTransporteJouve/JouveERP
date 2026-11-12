import { describe, expect, it } from "vitest";

import { linesFollowingDefault } from "./holder-default";

const PEAJES = "00000000-0000-4000-8000-000000000001";
const SEGUROS = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE = "00000000-0000-4000-8000-0000000000e1";

const line = (
  id: string,
  over: Partial<{
    card_last4: string | null;
    currency: string;
    source: string;
    treatment: string;
    chart_account_id: string | null;
    employee_id: string | null;
  }> = {},
) => ({
  id,
  card_last4: "1111",
  currency: "ARS",
  source: "purchase",
  treatment: "expense",
  chart_account_id: PEAJES,
  employee_id: null,
  ...over,
});

const previous = {
  treatment: "expense",
  chart_account_id: PEAJES,
  employee_id: null,
};
const next = {
  treatment: "expense",
  chart_account_id: SEGUROS,
  employee_id: null,
};
const base = {
  last4: "1111",
  previous,
  next,
  paidParts: ["ARS"],
  hrWrite: true,
};

describe("linesFollowingDefault", () => {
  it("takes the card's paid lines still on the previous default", () => {
    const lines = [line("a"), line("b")];
    expect(linesFollowingDefault(lines, base).map((l) => l.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("leaves a line changed by hand as it is", () => {
    const lines = [line("a"), line("hand", { chart_account_id: SEGUROS })];
    expect(linesFollowingDefault(lines, base).map((l) => l.id)).toEqual(["a"]);
  });

  it("only touches the card's lines of a paid part", () => {
    const lines = [
      line("other-card", { card_last4: "2222" }),
      line("charge", { card_last4: null, source: "charge" }),
      line("usd", { currency: "USD" }),
    ];
    expect(linesFollowingDefault(lines, base)).toEqual([]);
  });

  it("does nothing without a previous default or when it does not change", () => {
    expect(
      linesFollowingDefault([line("a")], { ...base, previous: null }),
    ).toEqual([]);
    expect(
      linesFollowingDefault([line("a")], { ...base, next: previous }),
    ).toEqual([]);
  });

  it("leaves advances as they are without Personal's write", () => {
    const advance = {
      treatment: "advance",
      chart_account_id: null,
      employee_id: EMPLOYEE,
    };
    const lines = [line("adv", advance)];
    expect(
      linesFollowingDefault(lines, {
        ...base,
        previous: advance,
        hrWrite: false,
      }),
    ).toEqual([]);
    expect(
      linesFollowingDefault(lines, { ...base, previous: advance }).map(
        (l) => l.id,
      ),
    ).toEqual(["adv"]);
  });

  it("never turns a bank charge into an advance", () => {
    const lines = [line("charge", { source: "charge" }), line("purchase")];
    expect(
      linesFollowingDefault(lines, {
        ...base,
        next: {
          treatment: "advance",
          chart_account_id: null,
          employee_id: EMPLOYEE,
        },
      }).map((l) => l.id),
    ).toEqual(["purchase"]);
  });
});
