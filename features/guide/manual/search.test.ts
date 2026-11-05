import { describe, expect, it } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import { GUIDE_PAGES } from "./content";
import { guideHrefForPath } from "./model";
import { searchGuide } from "./search";

describe("searchGuide", () => {
  it("finds a task by the words a user would ask with", () => {
    const [hit] = searchGuide(
      GUIDE_PAGES,
      "¿cómo cierro el mes contable?",
      resolveAccess(["owner"]),
    );
    expect(hit?.href).toBe("/manual/conceptos.html#cerrar-periodo");
    expect(hit?.steps[0]).toContain("«Períodos cerrados»");
  });

  it("says when the user cannot do the task, with the roles that can", () => {
    const [hit] = searchGuide(
      GUIDE_PAGES,
      "cerrar periodo",
      resolveAccess(["fiscal_reader"]),
    );
    expect(hit?.allowed).toBe(false);
    expect(hit?.roles).toContain("Owner");
  });

  it("returns nothing for a question with no content words", () => {
    expect(
      searchGuide(GUIDE_PAGES, "¿cómo?", resolveAccess(["owner"])),
    ).toEqual([]);
  });
});

describe("guideHrefForPath", () => {
  it("falls back to the guide's home for a route without a section", () => {
    expect(guideHrefForPath(GUIDE_PAGES, "/nope")).toBe("/manual/index.html");
    expect(guideHrefForPath(GUIDE_PAGES, "https://evil.example/x")).toBe(
      "/manual/index.html",
    );
  });
});
