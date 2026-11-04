// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InlineMoneyInput } from "./inline-money-input";

afterEach(cleanup);

function input(): HTMLInputElement {
  const el = screen.getByRole("textbox");
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  return el;
}

function typeAndBlur(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.blur(input());
}

describe("InlineMoneyInput", () => {
  it("shows the stored amount in es-AR format", () => {
    render(<InlineMoneyInput value={850000.5} onCommit={vi.fn()} />);
    expect(input().value).toBe("850.000,50");
  });

  it.each([
    ["150.000", 150000],
    ["1.500.000,50", 1500000.5],
    ["1,5", 1.5],
    ["1.234", 1234],
  ])("commits %s as %s", (text, expected) => {
    const onCommit = vi.fn();
    render(<InlineMoneyInput value={0} onCommit={onCommit} />);
    typeAndBlur(text);
    expect(onCommit).toHaveBeenCalledWith(expected);
  });

  it("does not commit an unchanged amount typed with thousands dots", () => {
    const onCommit = vi.fn();
    render(<InlineMoneyInput value={150000} onCommit={onCommit} />);
    typeAndBlur("150.000");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("drops a typed minus in sight", () => {
    render(<InlineMoneyInput value={10} onCommit={vi.fn()} />);
    fireEvent.change(input(), { target: { value: "-0,01" } });
    expect(input().value).toBe("0,01");
  });

  it("formats while typing and commits what it shows", () => {
    const onCommit = vi.fn();
    render(<InlineMoneyInput value={0} onCommit={onCommit} />);
    fireEvent.change(input(), { target: { value: "1500.50" } });
    expect(input().value).toBe("1.500,50");
    fireEvent.blur(input());
    expect(onCommit).toHaveBeenCalledWith(1500.5);
  });

  it("reverts junk without committing", () => {
    const onCommit = vi.fn();
    render(<InlineMoneyInput value={10} onCommit={onCommit} />);
    typeAndBlur("abc");
    expect(onCommit).not.toHaveBeenCalled();
    expect(input().value).toBe("10,00");
  });
});
