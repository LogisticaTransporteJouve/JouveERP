// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FilterField } from "./filter-field";

describe("FilterField", () => {
  it("stacks its label on top of the control and ties them by id", () => {
    const { container } = render(
      <FilterField id="corte" label="Período de corte">
        <button id="corte" type="button">
          nov 2026
        </button>
      </FilterField>,
    );
    const field = container.querySelector("[data-slot=filter-field]");
    expect(field?.className).toContain("grid");
    expect(field?.firstElementChild?.textContent).toBe("Período de corte");
    expect(screen.getByLabelText("Período de corte").id).toBe("corte");
  });
});
