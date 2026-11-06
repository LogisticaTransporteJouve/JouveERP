// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Pos = { numero: number; channel_id: string; nickname: string | null };

const h = vi.hoisted(() => ({
  pos: {
    data: undefined as ReadonlyArray<Pos> | undefined,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("../hooks/use-invoices", () => ({
  useEnabledPos: () => h.pos,
}));

const { PosSelect } = await import("./pos-select");

const pos = (numero: number): Pos => ({
  numero,
  channel_id: "jouve_fiscal",
  nickname: null,
});

afterEach(cleanup);
beforeEach(() => {
  h.pos = { data: undefined, isError: false, refetch: vi.fn() };
});

describe("PosSelect", () => {
  it("picks the channel's only point of sale and locks it", () => {
    h.pos.data = [pos(3)];
    const onChange = vi.fn();
    render(
      <PosSelect
        id="p"
        channelId="jouve_fiscal"
        value=""
        onChange={onChange}
      />,
    );
    expect(onChange).toHaveBeenCalledWith("3");
    expect(document.getElementById("p")?.hasAttribute("disabled")).toBe(true);
  });

  it("replaces a point of sale that is no longer enabled with the only one", () => {
    h.pos.data = [pos(3)];
    const onChange = vi.fn();
    render(
      <PosSelect channelId="jouve_fiscal" value="5" onChange={onChange} />,
    );
    expect(onChange).toHaveBeenCalledWith("3");
  });

  it("clears a value outside the list when there are several", () => {
    h.pos.data = [pos(3), pos(6)];
    const onChange = vi.fn();
    render(
      <PosSelect
        id="p"
        channelId="jouve_fiscal"
        value="5"
        onChange={onChange}
      />,
    );
    expect(onChange).toHaveBeenCalledWith("");
    expect(document.getElementById("p")?.hasAttribute("disabled")).toBe(false);
  });

  it("says the channel has none and picks nothing", () => {
    h.pos.data = [];
    const onChange = vi.fn();
    render(<PosSelect channelId="jouve_fiscal" value="" onChange={onChange} />);
    expect(
      screen.getByText("Este canal no tiene puntos de venta habilitados."),
    ).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a failed read with «Reintentar»", () => {
    h.pos.isError = true;
    render(<PosSelect channelId="jouve_fiscal" value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(h.pos.refetch).toHaveBeenCalled();
  });
});
