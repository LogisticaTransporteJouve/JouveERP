// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Tabs, TabsList, TabsTrigger } from "./tabs";

afterEach(cleanup);

describe("TabsList", () => {
  // Four or five tabs are wider than a phone: the list scrolls inside itself
  // instead of pushing the page sideways, and `center-safe` keeps the first
  // tab reachable once they overflow.
  it("scrolls its tabs inside the screen width", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Balance de saldos</TabsTrigger>
          <TabsTrigger value="b">Estado de Resultados</TabsTrigger>
          <TabsTrigger value="c">Balance General</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const list = screen.getByRole("tablist").className.split(" ");
    expect(list).toEqual(
      expect.arrayContaining([
        "max-w-full",
        "overflow-x-auto",
        "justify-center-safe",
      ]),
    );
    expect(list).not.toContain("justify-center");
  });
});
