import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { AfipTransportError } from "./errors";
import { afipFetch } from "./http";

let server: Server | null = null;

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
});

async function listen(
  handler: Parameters<typeof createServer>[1],
): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/`;
}

describe("afipFetch", () => {
  it("gives up with a transport error when AFIP accepts and never answers", async () => {
    const url = await listen(() => {
      // Accept the connection, never write a response.
    });
    const started = Date.now();
    const err = await afipFetch(url, { method: "POST", timeoutMs: 100 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AfipTransportError);
    expect((err as AfipTransportError).details).toEqual({ timedOut: true });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("applies the deadline to a body that never ends", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.write("<partial>");
    });
    await expect(
      afipFetch(url, { method: "POST", timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(AfipTransportError);
  });

  it("returns the status and body of an answer", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(500, { "Content-Type": "text/xml" });
      res.end("<fault/>");
    });
    await expect(afipFetch(url, { method: "POST" })).resolves.toEqual({
      ok: false,
      status: 500,
      text: "<fault/>",
    });
  });
});
