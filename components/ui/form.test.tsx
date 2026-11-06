// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormItem } from "./form";

describe("FormItem", () => {
  it("keeps its label on top when a form grid stretches it to a taller neighbour", () => {
    const { container } = render(<FormItem>campo</FormItem>);
    const item = container.querySelector("[data-slot=form-item]");
    expect(item?.className).toContain("grid");
    expect(item?.className).toContain("content-start");
  });
});
