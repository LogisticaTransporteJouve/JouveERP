// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { amountToInput, parseArAmount } from "@/lib/format";

import { emptyRetention, RetentionsEditor } from "./retentions-editor";

vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));

// Radix measures its controls; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

/** Saves the way receipt-form does: `parseArAmount(r.amount) ?? 0`. */
function Harness({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (amounts: number[]) => void;
}) {
  const [rets, setRets] = useState([
    { ...emptyRetention("2026-10-01"), amount: initial },
  ]);
  return (
    <>
      <RetentionsEditor
        retentions={rets}
        onChange={setRets}
        defaultDate="2026-10-01"
      />
      <button
        type="button"
        onClick={() => onSave(rets.map((r) => parseArAmount(r.amount) ?? 0))}
      >
        Guardar
      </button>
    </>
  );
}

function amountField(): HTMLInputElement {
  const el = screen.getByLabelText("Monto");
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

function save(onSave: ReturnType<typeof vi.fn>): unknown {
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  return onSave.mock.calls[0]?.[0];
}

describe("RetentionsEditor amount", () => {
  it("shows the receipt-form prefill of 1234.56 and saves it unchanged", () => {
    const onSave = vi.fn();
    render(<Harness initial={amountToInput(1234.56)} onSave={onSave} />);
    expect(amountField().value).toBe("1.234,56");
    expect(save(onSave)).toEqual([1234.56]);
  });

  it("drops a typed dot in sight and saves a typed 1.234,56 as 1234.56", () => {
    const onSave = vi.fn();
    render(<Harness initial="" onSave={onSave} />);
    fireEvent.change(amountField(), { target: { value: "1234.56" } });
    expect(amountField().value).toBe("123.456");
    fireEvent.change(amountField(), { target: { value: "1.234,56" } });
    expect(save(onSave)).toEqual([1234.56]);
  });
});
