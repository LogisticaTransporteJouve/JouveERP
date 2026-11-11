import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// A dialog covers the layout's channel-read banner: every component that
// builds a channel select from `useScope().channels` says a failed read under
// it, or hands the list to the component that does.

const ROOT = path.resolve(__dirname, "..");
const READS_SCOPE_CHANNELS = /const \{[^}]*\bchannels\b[^}]*\} = useScope\(\)/;

/** Readers that render no channel select themselves, and where the list goes. */
const DELEGATES: Record<string, string | null> = {
  // Pass the channels to the receipt / payment-order form.
  "features/receipts/components/collect-dialog.tsx":
    "features/receipts/components/receipt-form.tsx",
  "features/payment-orders/components/pay-dialog.tsx":
    "features/payment-orders/components/payment-order-form.tsx",
  // Picks the fiscal channel for one-click accepts and the receipt form.
  "features/bank-reconciliation/components/statement-coding.tsx":
    "features/receipts/components/receipt-form.tsx",
};

function componentFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), {
    recursive: true,
    encoding: "utf8",
  })
    .map((f) => path.posix.join(dir, f.split(path.sep).join("/")))
    .filter(
      (f) =>
        f.includes("/components/") &&
        f.endsWith(".tsx") &&
        !f.endsWith(".test.tsx"),
    );
}

const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const readers = componentFiles("features").filter((f) =>
  READS_SCOPE_CHANNELS.test(read(f)),
);

describe("channel read error reach", () => {
  it("finds the scope's channel readers", () => {
    expect(readers.length).toBeGreaterThan(10);
  });

  it.each(readers)("%s says a failed channel read", (file) => {
    if (file in DELEGATES) {
      const target = DELEGATES[file];
      if (target) expect(read(target)).toContain("<ChannelsReadError inline");
      return;
    }
    expect(read(file)).toContain("<ChannelsReadError inline");
  });

  it("every delegate still reads the scope's channels", () => {
    for (const file of Object.keys(DELEGATES)) {
      expect(readers, file).toContain(file);
    }
  });
});
