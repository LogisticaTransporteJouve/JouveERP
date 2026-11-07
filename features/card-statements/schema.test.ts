import { describe, expect, it } from "vitest";

import { statementAddsUp } from "./schema";

const statement = (usdLine: number) => ({
  number: "VI1",
  account_number: "1",
  close_date: "2026-10-29",
  due_date: "2026-11-11",
  total_ars: 1100,
  total_usd: 5,
  cards: [
    {
      last4: "1111",
      holder: "TITULAR",
      purchases: [
        {
          date: "2026-10-01",
          description: "PEAJE",
          installment: null,
          amount: 1000,
          currency: "ARS" as const,
        },
        {
          date: "2026-10-02",
          description: "SPOTIFY",
          installment: null,
          amount: usdLine,
          currency: "USD" as const,
        },
      ],
    },
  ],
  charges: [
    {
      date: "2026-10-29",
      description: "SELLOS",
      kind: "stamp_tax",
      amount: 100,
    },
  ],
});

describe("statementAddsUp", () => {
  it("accepts a statement whose lines are its totals", () => {
    expect(statementAddsUp(statement(5))).toBe(true);
  });

  it("refuses dollars that are not its purchases", () => {
    expect(statementAddsUp(statement(4))).toBe(false);
  });
});
