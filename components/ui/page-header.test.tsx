// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./button";
import { PageHeader } from "./page-header";

afterEach(cleanup);

function classes(el: Element | null): string[] {
  return (el?.className ?? "").split(" ");
}

describe("PageHeader", () => {
  it("renders the title as the page heading and its description", () => {
    render(
      <PageHeader title="Vehículos" description="Vehículos de la flota." />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Vehículos" }),
    ).toBeTruthy();
    expect(screen.getByText("Vehículos de la flota.")).toBeTruthy();
  });

  // On a phone a row of buttons next to the title was wider than the screen
  // and the whole page scrolled sideways: the row wraps below the title, and
  // the buttons wrap among themselves. From `sm` up it stays on one line.
  it("lets the title row and its buttons wrap on a phone", () => {
    render(
      <PageHeader
        title="Cargas de combustible"
        actions={
          <>
            <Button>Exportar</Button>
            <Button>Importar resumen</Button>
            <Button>Nueva carga</Button>
          </>
        }
      />,
    );
    const header = document.querySelector("[data-slot=page-header]");
    expect(classes(header)).toEqual(
      expect.arrayContaining(["flex-wrap", "sm:flex-nowrap"]),
    );
    const actions = document.querySelector("[data-slot=page-header-actions]");
    expect(classes(actions)).toContain("flex-wrap");
    expect(actions?.querySelectorAll("button")).toHaveLength(3);
    // The title block may shrink below its text width, so a long title wraps.
    expect(classes(screen.getByRole("heading").parentElement)).toContain(
      "min-w-0",
    );
  });

  it("renders no button row when there are no actions", () => {
    render(<PageHeader title="Viajes" actions={false} />);
    expect(document.querySelector("[data-slot=page-header-actions]")).toBe(
      null,
    );
  });
});
