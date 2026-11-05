import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The channel and puntos-de-venta selects that read through TanStack, not the
// layout's scope: a failed read is said under the select, not left as an
// empty list that reads as "no POS" or "no channels".

const ROOT = path.resolve(__dirname, "..");

/** Channel reads through a suspense query: a failure reaches the error
 *  boundary, never an empty list. */
const SUSPENSE_CHANNEL_READERS = new Set([
  "features/afip-admin/components/configure-pos-dialog.tsx",
  "features/afip-admin/components/sales-points-panel.tsx",
]);

const files = readdirSync(path.join(ROOT, "features"), {
  recursive: true,
  encoding: "utf8",
})
  .map((f) => path.posix.join("features", f.split(path.sep).join("/")))
  .filter(
    (f) =>
      f.includes("/components/") &&
      f.endsWith(".tsx") &&
      !f.endsWith(".test.tsx"),
  );
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const posReaders = files.filter((f) => read(f).includes("useEnabledPos("));
const channelReaders = files.filter(
  (f) =>
    read(f).includes("useInvoicingChannels(") &&
    !SUSPENSE_CHANNEL_READERS.has(f),
);

describe("puntos de venta and channel read error reach", () => {
  it("finds the readers", () => {
    expect(posReaders.length).toBeGreaterThanOrEqual(5);
    expect(channelReaders.length).toBeGreaterThanOrEqual(2);
  });

  it.each(posReaders)("%s says a failed puntos-de-venta read", (file) => {
    expect(read(file)).toContain("No se pudieron cargar los puntos de venta");
  });

  it.each(channelReaders)("%s says a failed channel read", (file) => {
    expect(read(file)).toContain("No se pudieron cargar los canales");
  });

  it("every suspense exception still reads the channels", () => {
    for (const file of SUSPENSE_CHANNEL_READERS) {
      expect(read(file), file).toContain("useInvoicingChannels(");
    }
  });
});
