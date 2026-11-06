// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog";
import { IconButton } from "./icon-button";

// Radix measures the tooltip; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

describe("IconButton", () => {
  it("names the button with its label", () => {
    render(
      <IconButton label="Editar">
        <Pencil />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
  });

  it("shows the label as a tooltip on hover", async () => {
    render(
      <IconButton label="Editar">
        <Pencil />
      </IconButton>,
    );
    fireEvent.pointerMove(screen.getByRole("button"), { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toBe("Editar");
  });

  it("shows the label as a tooltip on keyboard focus", async () => {
    render(
      <IconButton label="Editar">
        <Pencil />
      </IconButton>,
    );
    screen.getByRole("button").focus();
    expect((await screen.findByRole("tooltip")).textContent).toBe("Editar");
  });

  it("stays closed on a focus that is not keyboard focus", async () => {
    render(
      <IconButton label="Editar">
        <Pencil />
      </IconButton>,
    );
    // A focus event on an element that does not match :focus-visible, like
    // the focus a dialog closed with the mouse hands back to its trigger.
    fireEvent.focus(screen.getByRole("button"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps the tooltip on a disabled button, through a focusable wrapper", async () => {
    render(
      <IconButton label="Borrar" disabled>
        <Pencil />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Borrar" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const wrapper = button.parentElement!;
    expect(wrapper.tagName).toBe("SPAN");
    expect(wrapper.tabIndex).toBe(0);
    wrapper.focus();
    expect((await screen.findByRole("tooltip")).textContent).toBe("Borrar");
  });

  it("adds the disabled reason to the tooltip only while disabled", async () => {
    render(
      <IconButton label="Borrar" disabled disabledReason="Ya está anulada.">
        <Pencil />
      </IconButton>,
    );
    screen.getByRole("button", { name: "Borrar" }).parentElement!.focus();
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Borrar. Ya está anulada.",
    );
    cleanup();
    render(
      <IconButton label="Borrar" disabledReason="Ya está anulada.">
        <Pencil />
      </IconButton>,
    );
    screen.getByRole("button").focus();
    expect((await screen.findByRole("tooltip")).textContent).toBe("Borrar");
  });

  it("renders a link with asChild", () => {
    render(
      <IconButton label="Ver" asChild>
        <Link href="/invoices/1">
          <Pencil />
        </Link>
      </IconButton>,
    );
    const link = screen.getByRole("link", { name: "Ver" });
    expect(link.getAttribute("href")).toBe("/invoices/1");
  });

  it("works as the child of a DialogTrigger", () => {
    const onClick = vi.fn();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <IconButton label="Editar" onClick={onClick}>
            <Pencil />
          </IconButton>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Editar cuenta</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
