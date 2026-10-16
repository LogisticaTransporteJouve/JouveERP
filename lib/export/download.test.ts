// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  downloadFromUrl,
  exportFileName,
  SESSION_EXPIRED_MESSAGE,
} from "./download";
import { XLSX_MIME } from "./mime";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

describe("downloadFromUrl", () => {
  it("shows a refused request's message", async () => {
    stubFetch(Response.json({ error: "No tenés permiso." }, { status: 403 }));
    await expect(downloadFromUrl("/x", "x.xlsx", XLSX_MIME)).rejects.toThrow(
      "No tenés permiso.",
    );
  });

  it("hides a server error's internals", async () => {
    stubFetch(Response.json({ error: "Could not load." }, { status: 500 }));
    await expect(downloadFromUrl("/x", "x.xlsx", XLSX_MIME)).rejects.toThrow(
      "No se pudo descargar el archivo.",
    );
  });

  it("reports an expired session instead of saving the login page", async () => {
    stubFetch(
      new Response("<html></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );
    await expect(downloadFromUrl("/x", "x.xlsx", XLSX_MIME)).rejects.toThrow(
      SESSION_EXPIRED_MESSAGE,
    );
    const redirected = new Response("", {
      headers: { "Content-Type": XLSX_MIME },
    });
    Object.defineProperty(redirected, "redirected", { value: true });
    stubFetch(redirected);
    await expect(downloadFromUrl("/x", "x.xlsx", XLSX_MIME)).rejects.toThrow(
      SESSION_EXPIRED_MESSAGE,
    );
  });

  it("never saves another content type", async () => {
    stubFetch(Response.json({ ok: true }));
    await expect(downloadFromUrl("/x", "x.xlsx", XLSX_MIME)).rejects.toThrow(
      "No se pudo descargar el archivo.",
    );
  });

  it("saves the file under the route's name", async () => {
    stubFetch(
      new Response("data", {
        headers: {
          "Content-Type": XLSX_MIME,
          "Content-Disposition": 'attachment; filename="a-1.xlsx"',
        },
      }),
    );
    const createObjectURL = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("a-1.xlsx");
      });
    await downloadFromUrl("/x", "x.xlsx", XLSX_MIME);
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
  });
});

describe("exportFileName", () => {
  it("slugs the title with the extension", () => {
    expect(exportFileName("Saldos — junio", "xlsx")).toBe("saldos-junio.xlsx");
  });
});
