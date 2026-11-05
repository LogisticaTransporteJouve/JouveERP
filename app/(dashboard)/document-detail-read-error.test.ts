import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// A failed read on a document detail reaches the error boundary
// («Reintentar»); only a document that is not there renders not-found
// («Puede que se haya eliminado»), which for an emitted factura would invite
// issuing it again.

const PAGES = [
  "invoices/[id]/page.tsx",
  "purchases/[id]/page.tsx",
  "payment-orders/[id]/page.tsx",
  "receipts/[id]/page.tsx",
];

const read = (f: string) => readFileSync(path.join(__dirname, f), "utf8");

describe("document detail pages tell a failed read from not found", () => {
  it.each(PAGES)("%s throws on a failed read", (page) => {
    const src = read(page);
    expect(src).toMatch(/if \(!\w+\.ok\) throw new Error\(\w+\.error\);/);
    expect(src).not.toMatch(/if \(!\w+\.ok[^)]*\)\s*notFound\(\)/);
  });
});
