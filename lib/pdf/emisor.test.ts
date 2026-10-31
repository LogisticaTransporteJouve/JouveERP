import { describe, expect, it } from "vitest";

import { divisionLabel } from "./emisor";

describe("divisionLabel", () => {
  it("keeps the text the PDFs printed before", () => {
    expect(divisionLabel("jouve", "x")).toBe("Logística Jouve");
    expect(divisionLabel("dz", "x")).toBe("DZ Instalaciones");
  });

  it("falls back to the channel name", () => {
    expect(divisionLabel(null, "Canal")).toBe("Canal");
    expect(divisionLabel("otra", "Canal")).toBe("Canal");
  });
});
