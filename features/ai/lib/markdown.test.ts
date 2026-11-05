// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { renderAiMarkdown } from "./markdown";

describe("renderAiMarkdown", () => {
  it("opens links into the user guide in the guide's reused tab", () => {
    const html = renderAiMarkdown(
      "Ver [Cerrar un período](/manual/conceptos.html#cerrar-periodo).",
    );
    expect(html).toContain(
      '<a href="/manual/conceptos.html#cerrar-periodo" target="jouve-manual">',
    );
  });

  it("leaves other links alone", () => {
    expect(renderAiMarkdown("[Clientes](/clients)")).toContain(
      '<a href="/clients">',
    );
  });
});
