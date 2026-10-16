// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadFromUrl, exportFileName } from "./download";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

describe("downloadFromUrl", () => {
  it("shows a refused request's message", async () => {
    stubFetch(Response.json({ error: "No tenés permiso." }, { status: 403 }));
    await expect(downloadFromUrl("/x", "x.xlsx")).rejects.toThrow(
      "No tenés permiso.",
    );
  });

  it("hides a server error's internals", async () => {
    stubFetch(Response.json({ error: "Could not load." }, { status: 500 }));
    await expect(downloadFromUrl("/x", "x.xlsx")).rejects.toThrow(
      "No se pudo descargar el archivo.",
    );
  });

  it("saves the file under the route's name", async () => {
    stubFetch(
      new Response("data", {
        headers: { "Content-Disposition": 'attachment; filename="a-1.xlsx"' },
      }),
    );
    const createObjectURL = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("a-1.xlsx");
      });
    await downloadFromUrl("/x", "x.xlsx");
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
  });
});

describe("exportFileName", () => {
  it("slugs the title with the extension", () => {
    expect(exportFileName("Saldos — junio", "xlsx")).toBe("saldos-junio.xlsx");
  });
});
