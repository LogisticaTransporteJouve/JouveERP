// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DisabledHint, firstReason, NO_CHANGES_REASON } from "./disabled-hint";
import { Button } from "./ui/button";

// Radix measures the tooltip; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

describe("DisabledHint", () => {
  it("renders the button untouched with no reason", () => {
    render(
      <DisabledHint reason={null}>
        <Button>Guardar</Button>
      </DisabledHint>,
    );
    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button.parentElement?.dataset.slot).not.toBe("disabled-hint");
  });

  it("shows the reason on keyboard focus of a disabled button's wrapper", async () => {
    render(
      <DisabledHint reason={NO_CHANGES_REASON}>
        <Button disabled>Guardar</Button>
      </DisabledHint>,
    );
    const button = screen.getByRole("button", { name: "Guardar" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const wrapper = button.parentElement!;
    expect(wrapper.dataset.slot).toBe("disabled-hint");
    expect(wrapper.tabIndex).toBe(0);
    wrapper.focus();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toBe(NO_CHANGES_REASON);
    expect(wrapper.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("puts layout classes on the wrapper", () => {
    render(
      <DisabledHint reason="Elegí la cuenta." className="ml-auto">
        <Button disabled>Pagar</Button>
      </DisabledHint>,
    );
    const wrapper = screen.getByRole("button").parentElement!;
    expect(wrapper.className).toContain("ml-auto");
  });
});

describe("firstReason", () => {
  it("returns the first reason whose condition holds", () => {
    expect(
      firstReason(
        [false, "Elegí el canal."],
        [true, "Elegí la cuenta."],
        [true, "Completá la fecha."],
      ),
    ).toBe("Elegí la cuenta.");
  });

  it("returns null when nothing blocks", () => {
    expect(firstReason([false, "Elegí el canal."])).toBeNull();
  });
});
