// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiHistoryMenu } from "./ai-history";

afterEach(cleanup);

const sessions = [
  {
    id: "s1",
    title: "Caja de octubre",
    message_count: 4,
    updated_at: new Date().toISOString(),
  },
];

function menu() {
  const props = {
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <AiHistoryMenu
      sessions={sessions}
      isLoading={false}
      activeId="s1"
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Historial/ }));
  return props;
}

describe("AiHistoryMenu", () => {
  it("opens a conversation from the header menu", () => {
    const props = menu();
    expect(screen.getByText("Hoy")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Caja de octubre" }));
    expect(props.onSelect).toHaveBeenCalledWith("s1");
  });

  it("keeps the delete confirmation open after the menu closes", () => {
    const props = menu();
    fireEvent.click(
      screen.getByRole("button", { name: "Borrar conversación" }),
    );
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Borrar" }));
    expect(props.onDelete).toHaveBeenCalledWith("s1");
  });
});
