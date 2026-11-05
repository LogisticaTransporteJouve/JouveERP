// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Calendar } from "./calendar";
import { DatePicker } from "./date-picker";

// Radix measures its popper; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 5, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function weekdayHeader(): string[] {
  // react-day-picker hides the header row from the a11y tree (each day
  // button already names its weekday), so read the cells directly.
  return [...document.querySelectorAll("thead th")].map(
    (th) => th.textContent ?? "",
  );
}

describe("Calendar", () => {
  it("speaks Spanish and starts the week on Monday", () => {
    render(
      <Calendar
        mode="single"
        defaultMonth={new Date(2026, 10, 1)}
        captionLayout="dropdown"
      />,
    );
    expect(weekdayHeader()).toEqual(["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"]);
    expect(screen.getByRole("grid").getAttribute("aria-label")).toBe(
      "noviembre 2026",
    );
    expect(
      screen.getByRole("combobox", { name: "Elegir el mes" }),
    ).toBeTruthy();
    expect(screen.getByRole("option", { name: "Nov" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Ir al mes siguiente" }),
    ).toBeTruthy();
    // The 1st of November 2026 is a Sunday: the last column of the first row.
    const firstRow = screen.getAllByRole("row")[0];
    expect(firstRow?.lastElementChild?.textContent).toBe("1");
  });

  it("lets the year dropdown reach the years ahead", () => {
    render(<Calendar mode="single" captionLayout="dropdown" />);
    const years = screen.getByRole("combobox", { name: "Elegir el año" });
    expect(years.textContent).toContain("2036");
  });
});

describe("DatePicker", () => {
  it("shows dd/mm/yyyy and emits YYYY-MM-DD", () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-11-05" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /05\/11\/2026/ }));
    fireEvent.click(screen.getByRole("button", { name: /20 de noviembre/ }));
    expect(onChange).toHaveBeenCalledWith("2026-11-20");
  });

  it("disables the days outside min and max", () => {
    const onChange = vi.fn();
    render(
      <DatePicker
        value="2026-11-05"
        onChange={onChange}
        min="2026-11-03"
        max="2026-11-10"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /05\/11\/2026/ }));
    const late = screen.getByRole("button", { name: /11 de noviembre/ });
    expect(late).toHaveProperty("disabled", true);
    const early = screen.getByRole("button", { name: /, 2 de noviembre/ });
    expect(early).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: /10 de noviembre/ }));
    expect(onChange).toHaveBeenCalledWith("2026-11-10");
  });

  it("forwards the form-field props to its trigger", () => {
    const onBlur = vi.fn();
    render(
      <DatePicker
        value=""
        onChange={vi.fn()}
        id="due"
        aria-invalid
        aria-describedby="due-msg"
        onBlur={onBlur}
        disabled
      />,
    );
    const trigger = screen.getByRole("button", { name: /Elegí fecha/ });
    expect(trigger.id).toBe("due");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.getAttribute("aria-describedby")).toBe("due-msg");
    expect(trigger).toHaveProperty("disabled", true);
    fireEvent.blur(trigger);
    expect(onBlur).toHaveBeenCalled();
  });

  it("clears only when clearable", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DatePicker value="2026-11-05" onChange={onChange} />,
    );
    expect(screen.queryByRole("button", { name: "Limpiar fecha" })).toBeNull();
    rerender(<DatePicker value="2026-11-05" onChange={onChange} clearable />);
    fireEvent.click(screen.getByRole("button", { name: "Limpiar fecha" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
