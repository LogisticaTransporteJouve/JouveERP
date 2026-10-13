import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it.each([
    "/dashboard",
    "/invoices/123?tab=items",
    "/reports#iva",
    "/",
    "/clients?q=%2F%2Fevil.com",
  ])("accepts same-origin path %s", (value) => {
    expect(safeRedirectPath(value)).toBe(value);
  });

  it.each([
    "//evil.com",
    "//evil.com/dashboard",
    "/\\evil.com",
    "/\\/evil.com",
    "\\\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r\n//evil.com",
    "/dashboard\u0000",
    "https://evil.com",
    "http:/evil.com",
    "javascript:alert(1)",
    "evil.com",
    "dashboard",
    "",
    `/${"a".repeat(3000)}`,
  ])("rejects %j", (value) => {
    expect(safeRedirectPath(value)).toBeNull();
  });

  it("rejects missing values", () => {
    expect(safeRedirectPath(undefined)).toBeNull();
    expect(safeRedirectPath(null)).toBeNull();
  });
});
