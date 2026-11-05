import { describe, expect, it } from "vitest";

import { GUIDE_PAGES } from "./content";
import { renderIndex, renderPage, renderSearchIndex } from "./render";

// docs/manual/ is generated from the content in ./content. `pnpm manual:build`
// (vitest -u) rewrites the files; in CI a stale file fails here.

const DIR = "../../../docs/manual";

describe("docs/manual is up to date (pnpm manual:build)", () => {
  it("index.html", async () => {
    await expect(renderIndex(GUIDE_PAGES)).toMatchFileSnapshot(
      `${DIR}/index.html`,
    );
  });

  it.each(GUIDE_PAGES.map((p) => [p.file, p]))("%s", async (_file, page) => {
    await expect(renderPage(GUIDE_PAGES, page)).toMatchFileSnapshot(
      `${DIR}/${page.file}`,
    );
  });

  it("assets/search-index.js", async () => {
    await expect(renderSearchIndex(GUIDE_PAGES)).toMatchFileSnapshot(
      `${DIR}/assets/search-index.js`,
    );
  });
});
