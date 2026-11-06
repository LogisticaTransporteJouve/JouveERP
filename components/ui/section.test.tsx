// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Section } from "./section";

afterEach(cleanup);

describe("Section", () => {
  // A grid with no explicit column gets one `auto` track, which grows to the
  // widest child's min-content (a row of nowrap text, a table): on a phone
  // the whole page then scrolls sideways. `grid-cols-1` is minmax(0, 1fr).
  it("keeps its column to the available width", () => {
    render(
      <Section title="Próximos vencimientos">
        <p>contenido</p>
      </Section>,
    );
    const section = screen.getByRole("region", {
      name: "Próximos vencimientos",
    });
    expect(section.className.split(" ")).toContain("grid-cols-1");
  });
});
