// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseArAmount } from "@/lib/format";

import { MoneyInput } from "./money-input";

afterEach(cleanup);

function Harness({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (value: number | null) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MoneyInput aria-label="Importe" value={value} onChange={setValue} />
      <button type="button" onClick={() => onSave(parseArAmount(value))}>
        Guardar
      </button>
    </>
  );
}

function input(): HTMLInputElement {
  const el = screen.getByLabelText("Importe");
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

function typeAndSave(text: string, initial = ""): number | null {
  const onSave = vi.fn();
  render(<Harness initial={initial} onSave={onSave} />);
  for (const ch of text) {
    fireEvent.change(input(), { target: { value: input().value + ch } });
  }
  fireEvent.blur(input());
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  return onSave.mock.calls[0]?.[0];
}

describe("MoneyInput", () => {
  it("is a decimal text field, so an es-AR prefill shows", () => {
    render(<Harness initial="850.000,00" onSave={vi.fn()} />);
    expect(input().type).toBe("text");
    expect(input().inputMode).toBe("decimal");
    expect(input().value).toBe("850.000,00");
  });

  it.each([
    ["1500,50", "1.500,50", 1500.5],
    // A lone dot with 1–2 digits after it is the decimal mark (numpad).
    ["1500.50", "1.500,50", 1500.5],
    ["15.5", "15,5", 15.5],
    // With exactly 3 it groups thousands, as many users type them.
    ["15.000", "15.000", 15000],
    ["850.000,00", "850.000,00", 850_000],
    ["850000,00", "850.000,00", 850_000],
  ])("typing %s shows %s on blur and saves %s", (typed, shown, saved) => {
    expect(typeAndSave(typed)).toBe(saved);
    expect(input().value).toBe(shown);
  });

  it.each([
    ["1.234,56", "1.234,56", 1234.56],
    ["1,234.56", "1.234,56", 1234.56],
    ["15.000", "15.000", 15000],
    ["1500.5", "1.500,5", 1500.5],
  ])("pasting %s shows %s and saves %s", (pasted, shown, saved) => {
    const onSave = vi.fn();
    render(<Harness initial="" onSave={onSave} />);
    fireEvent.change(input(), { target: { value: pasted } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(input().value).toBe(shown);
    expect(onSave).toHaveBeenCalledWith(saved);
  });

  it("keeps the text as typed until blur, so the cursor does not jump", () => {
    render(<Harness initial="" onSave={vi.fn()} />);
    for (const ch of "15.") {
      fireEvent.change(input(), { target: { value: input().value + ch } });
    }
    expect(input().value).toBe("15.");
    fireEvent.blur(input());
    expect(input().value).toBe("15");
  });

  it("drops a minus unless allowNegative", () => {
    render(<MoneyInput aria-label="A" value="" onChange={onA} />);
    render(<MoneyInput aria-label="B" value="" onChange={onB} allowNegative />);
    fireEvent.change(screen.getByLabelText("A"), { target: { value: "-15" } });
    fireEvent.change(screen.getByLabelText("B"), { target: { value: "-15" } });
    expect(onA).toHaveBeenCalledWith("15");
    expect(onB).toHaveBeenCalledWith("-15");
  });
});

const onA = vi.fn();
const onB = vi.fn();
