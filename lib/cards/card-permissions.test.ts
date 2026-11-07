import { describe, expect, it } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import { cardPartDenied } from "./card-permissions";

const finance = (denies: string[] = []) => resolveAccess(["finance"], denies);

describe("cardPartDenied", () => {
  const advance = [{ treatment: "advance", chart_account_id: null }];
  const tax = [{ treatment: "expense", chart_account_id: "iva" }];

  it("lets finance pay advances and tax credits", () => {
    expect(
      cardPartDenied(finance(), [...advance, ...tax], new Set(["iva"])),
    ).toBeNull();
  });

  it("refuses advances to whoever lacks Personal's write", () => {
    expect(cardPartDenied(finance(["hr:write"]), advance, new Set())).toMatch(
      /Personal/,
    );
  });

  it("refuses tax credits to whoever lacks Impuestos' write", () => {
    expect(
      cardPartDenied(finance(["taxes:write"]), tax, new Set(["iva"])),
    ).toMatch(/Impuestos/);
  });
});
