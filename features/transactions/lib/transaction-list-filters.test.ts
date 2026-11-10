import { describe, expect, it } from "vitest";

import {
  accountTransactionListParamsToUrl,
  parseTransactionListParams,
  transactionListFilters,
  transactionListParamsToUrl,
} from "./transaction-list-filters";

const ID = "00000000-0000-4000-8000-0000000000aa";

describe("Caja `?id=` (one movement)", () => {
  it("parses, round-trips and filters by the movement id", () => {
    const params = parseTransactionListParams({ id: ID });
    expect(params.id).toBe(ID);
    expect(transactionListParamsToUrl(params).id).toBe(ID);
    expect(transactionListFilters(params, null).id).toBe(ID);
  });

  it("ignores an id that is not a uuid", () => {
    expect(parseTransactionListParams({ id: "t1" }).id).toBeNull();
  });
});

describe("accountTransactionListParamsToUrl", () => {
  it("writes «Todas las fechas» as period=all, so the statement tab keeps it", () => {
    const params = parseTransactionListParams({ account: "a1" });
    expect(accountTransactionListParamsToUrl(params).period).toBe("all");
    expect(
      accountTransactionListParamsToUrl(
        parseTransactionListParams({ account: "a1", period: "last_month" }),
      ).period,
    ).toBe("last_month");
  });
});
