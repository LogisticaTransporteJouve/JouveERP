// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListGroupToggle } from "./list-totals";

afterEach(cleanup);

describe("ListGroupToggle", () => {
  // At 320 px «Lista / Por día / Por semana / Por mes» was 6 px wider than the
  // screen: on a phone the options get tighter padding, and if they still do
  // not fit they scroll inside the switch, never the page.
  it("fits the switch to the screen width on a phone", () => {
    render(<ListGroupToggle value={null} onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Vista" });
    expect(group.className.split(" ")).toEqual(
      expect.arrayContaining(["max-w-full", "overflow-x-auto"]),
    );
    for (const option of screen.getAllByRole("radio")) {
      expect(option.className.split(" ")).toEqual(
        expect.arrayContaining(["shrink-0", "max-sm:px-2"]),
      );
    }
  });

  it("selects a grouping", () => {
    const onChange = vi.fn();
    render(<ListGroupToggle value={null} onChange={onChange} />);
    expect(
      screen.getByRole("radio", { name: "Lista" }).getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Por mes" }));
    expect(onChange).toHaveBeenCalledWith("month");
  });
});
