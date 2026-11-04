import { describe, expect, it } from "vitest";

import { formatMoneyWithCode } from "@/lib/format";

import { checksInCartera } from "./checks-in-cartera";

// Audit w3-s8 F2: the dashboard shows the USD cartera Tesorería shows.
describe("checksInCartera", () => {
  it("shows each currency on its own", () => {
    expect(checksInCartera({ checks_now: 1000, checks_usd_now: 50 })).toBe(
      `${formatMoneyWithCode(1000, "ARS")} · ${formatMoneyWithCode(50, "USD")}`,
    );
  });

  it("shows a USD-only cartera", () => {
    expect(checksInCartera({ checks_now: 0, checks_usd_now: 50 })).toBe(
      formatMoneyWithCode(50, "USD"),
    );
  });
});
