// @vitest-environment jsdom
import { zodResolver } from "@hookform/resolvers/zod";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { MonthPicker, formatMonthDisplay } from "./month-picker";

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

function open(name: RegExp | string = /Elegí mes|\d{4}/) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function month(label: string): HTMLElement {
  return screen.getByRole("button", { name: label });
}

describe("formatMonthDisplay", () => {
  it("shows the short Spanish month and the year", () => {
    expect(formatMonthDisplay("2026-11")).toBe("nov 2026");
    expect(formatMonthDisplay("2027-01")).toBe("ene 2027");
    expect(formatMonthDisplay("")).toBe("");
    expect(formatMonthDisplay("2026-13")).toBe("");
  });
});

describe("MonthPicker", () => {
  it("shows the value in Spanish and emits YYYY-MM on pick", () => {
    const onChange = vi.fn();
    render(<MonthPicker value="2026-11" onChange={onChange} />);
    expect(screen.getByRole("button", { name: /nov 2026/ })).toBeTruthy();

    open(/nov 2026/);
    expect(screen.getByRole("group", { name: "Meses de 2026" })).toBeTruthy();
    expect(month("noviembre de 2026").getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(month("marzo de 2026"));
    expect(onChange).toHaveBeenCalledWith("2026-03");
  });

  it("changes the year with the switcher and the keyboard", () => {
    const onChange = vi.fn();
    render(<MonthPicker value="2026-11" onChange={onChange} />);
    open(/nov 2026/);

    fireEvent.click(screen.getByRole("button", { name: "Año anterior" }));
    fireEvent.click(month("enero de 2025"));
    expect(onChange).toHaveBeenLastCalledWith("2025-01");

    open(/nov 2026/);
    const grid = screen.getByRole("group", { name: "Meses de 2026" });
    // Diciembre → ArrowRight crosses into enero of the next year.
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(document.activeElement).toBe(month("enero de 2027"));
    fireEvent.keyDown(grid, { key: "PageDown" });
    expect(document.activeElement).toBe(month("enero de 2028"));
    fireEvent.click(document.activeElement!);
    expect(onChange).toHaveBeenLastCalledWith("2028-01");
  });

  it("disables the months outside min and max", () => {
    const onChange = vi.fn();
    render(
      <MonthPicker
        value="2026-11"
        onChange={onChange}
        min="2025-12"
        max="2026-11"
      />,
    );
    open(/nov 2026/);
    expect(month("diciembre de 2026").getAttribute("aria-disabled")).toBe(
      "true",
    );
    fireEvent.click(month("diciembre de 2026"));
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Año siguiente" }),
    ).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "Año anterior" }));
    expect(month("noviembre de 2025").getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Año anterior" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(month("diciembre de 2025"));
    expect(onChange).toHaveBeenCalledWith("2025-12");
  });

  it("opens on this month kept inside max when empty", () => {
    render(<MonthPicker value="" onChange={vi.fn()} max="2026-06" />);
    open("Elegí mes");
    expect(screen.getByRole("group", { name: "Meses de 2026" })).toBeTruthy();
    expect(document.activeElement).toBe(month("junio de 2026"));
    // «Este mes» (noviembre) is past max: no shortcut.
    expect(screen.queryByRole("button", { name: "Este mes" })).toBeNull();
  });

  it("clears only when clearable", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MonthPicker value="2026-11" onChange={onChange} />,
    );
    expect(screen.queryByRole("button", { name: "Limpiar mes" })).toBeNull();

    rerender(<MonthPicker value="2026-11" onChange={onChange} clearable />);
    fireEvent.click(screen.getByRole("button", { name: "Limpiar mes" }));
    expect(onChange).toHaveBeenCalledWith("");
    fireEvent.keyDown(screen.getByRole("button", { name: /nov 2026/ }), {
      key: "Delete",
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("works as a react-hook-form field with a Zod schema", async () => {
    const Schema = z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/, "Elegí un período."),
    });
    const onSubmit = vi.fn();
    function Harness() {
      const form = useForm<z.infer<typeof Schema>>({
        resolver: zodResolver(Schema),
        defaultValues: { period: "" },
      });
      return (
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => onSubmit(v))}>
            <FormField
              control={form.control}
              name="period"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Período</FormLabel>
                  <FormControl>
                    <MonthPicker {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit">Guardar</Button>
          </form>
        </Form>
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Elegí un período.")).toBeTruthy();
    // FormLabel names the trigger and FormControl marks it invalid.
    const trigger = screen.getByRole("button", { name: "Período" });
    expect(trigger.getAttribute("aria-invalid")).toBe("true");

    fireEvent.click(trigger);
    fireEvent.click(month("agosto de 2026"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ period: "2026-08" }),
    );
  });
});
