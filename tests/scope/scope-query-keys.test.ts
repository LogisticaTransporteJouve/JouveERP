import { hashKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { agingKeys } from "@/features/aging/lib/aging-keys";
import { invoicesKeys } from "@/features/invoices/lib/invoices-keys";
import { transactionsKeys } from "@/features/transactions/lib/transactions-keys";
import {
  FISCAL_FILTERS,
  isFiscalFor,
  parseFiscalFilter,
  serializeFiscalFilter,
} from "@/lib/scope";

// The server prefetch reads the scope from the cookie the selector wrote; the
// client reads it from the provider. Both must land on the same query key, or
// the prefetched page is thrown away and refetched.

describe.each(FISCAL_FILTERS)("scope %s", (scope) => {
  const fromCookie = isFiscalFor(
    parseFiscalFilter(
      decodeURIComponent(encodeURIComponent(serializeFiscalFilter(scope))),
    ),
  );
  const fromProvider = isFiscalFor(scope);

  it("invoices list", () => {
    expect(
      hashKey(
        invoicesKeys.searchInfinite({
          isFiscal: fromCookie,
          status: null,
          query: "",
        }),
      ),
    ).toBe(
      hashKey(
        invoicesKeys.searchInfinite({
          query: "",
          status: null,
          isFiscal: fromProvider,
        }),
      ),
    );
  });

  it("transactions list", () => {
    const server = {
      is_fiscal: fromCookie,
      account_id: null,
      kind: null,
      date_from: null,
      date_to: null,
    };
    const client = {
      is_fiscal: fromProvider,
      account_id: null,
      kind: null,
      date_from: null,
      date_to: null,
    };
    expect(hashKey(transactionsKeys.list(server))).toBe(
      hashKey(transactionsKeys.list(client)),
    );
  });

  it("aging", () => {
    expect(hashKey(agingKeys.summary(fromCookie))).toBe(
      hashKey(agingKeys.summary(fromProvider)),
    );
  });
});
