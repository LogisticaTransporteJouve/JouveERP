import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import manifest from "./manifest";

describe("web app manifest", () => {
  it("opens standalone inside the app's scope", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.scope).toBe("/");
    expect(m.start_url?.startsWith("/")).toBe(true);
  });

  it("points at icons that exist in public/", () => {
    for (const icon of manifest().icons ?? []) {
      expect(existsSync(path.join(__dirname, "../public", icon.src))).toBe(
        true,
      );
    }
  });
});
