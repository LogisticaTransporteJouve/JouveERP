import forge from "node-forge";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AfipTransportError } from "./errors";
import { AFIP_TIMEOUT_MS } from "./http";

type CachedTa = { token: string; sign: string; expiration_time: string };

const h = vi.hoisted(() => ({
  calls: [] as Array<{ timeoutMs?: number }>,
  certPem: "",
  keyPem: "",
  /** Results of the next cache reads, in order; then `{ data: stored }`. */
  reads: [] as Array<{ data: unknown; error: { message: string } | null }>,
  /** Results of the next upserts, in order; then success. */
  writes: [] as Array<{ message: string } | null>,
  upserts: 0,
  stored: null as CachedTa | null,
  /** The WSAA answer: a fresh TA, or the fault for a TA still valid. */
  login: "ok" as "ok" | "alreadyAuthenticated",
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () =>
        h.reads.shift() ?? { data: h.stored, error: null },
      upsert: async () => {
        h.upserts += 1;
        return { error: h.writes.shift() ?? null };
      },
    };
    return { from: () => builder };
  },
}));
vi.mock("./env", () => ({
  getAfipCert: () => h.certPem,
  getAfipKey: () => h.keyPem,
  getWsaaUrl: () => "https://wsaa.test/LoginCms",
}));
vi.mock("./http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./http")>()),
  afipFetch: async (_url: string, init: { timeoutMs?: number }) => {
    h.calls.push(init);
    if (h.login === "alreadyAuthenticated") {
      return {
        ok: false,
        status: 500,
        text: "<soapenv:Fault><faultcode>ns1:coe.alreadyAuthenticated</faultcode></soapenv:Fault>",
      };
    }
    const expiration = new Date(Date.now() + 12 * 3_600_000).toISOString();
    const ticket = `<loginTicketResponse><credentials><token>T</token><sign>S</sign></credentials><header><expirationTime>${expiration}</expirationTime></header></loginTicketResponse>`;
    const escaped = ticket.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return {
      ok: true,
      status: 200,
      text: `<soapenv:Envelope><soapenv:Body><loginCmsResponse><loginCmsReturn>${escaped}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`,
    };
  },
}));

const { WSAA_TIMEOUT_MS, TA_WRITE_RETRY_DELAYS_MS, getAccessTicket } =
  await import("./wsaa");

function selfSigned() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attrs = [{ name: "commonName", value: "test" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

const keys = selfSigned();

// The in-memory TA cache is module state: each test uses its own service.
beforeEach(() => {
  Object.assign(h, keys);
  h.calls.length = 0;
  h.reads.length = 0;
  h.writes.length = 0;
  h.upserts = 0;
  h.stored = null;
  h.login = "ok";
});

describe("getAccessTicket", () => {
  it("waits longer for a login than for other AFIP calls: a TA issued after a client timeout is lost", async () => {
    const ta = await getAccessTicket("wsfe");
    expect(ta.token).toBe("T");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.timeoutMs).toBe(WSAA_TIMEOUT_MS);
    expect(WSAA_TIMEOUT_MS).toBeGreaterThan(AFIP_TIMEOUT_MS);
  });

  it("does not log in when the cache read fails: another instance's TA may be valid", async () => {
    h.reads.push({ data: null, error: { message: "timeout" } });
    await expect(getAccessTicket("read-fails")).rejects.toBeInstanceOf(
      AfipTransportError,
    );
    expect(h.calls).toHaveLength(0);
  });

  it("retries a failed write of a fresh TA", async () => {
    h.writes.push({ message: "blip" });
    const ta = await getAccessTicket("write-blip");
    expect(ta.token).toBe("T");
    expect(h.upserts).toBe(2);
  });

  it("fails retriably while a fresh TA is not stored, and stores it on the next call without a second login", async () => {
    h.writes.push(
      ...Array.from({ length: TA_WRITE_RETRY_DELAYS_MS.length + 1 }, () => ({
        message: "db down",
      })),
    );
    await expect(getAccessTicket("write-down")).rejects.toBeInstanceOf(
      AfipTransportError,
    );
    const ta = await getAccessTicket("write-down");
    expect(ta.token).toBe("T");
    expect(h.calls).toHaveLength(1);
    expect(h.upserts).toBe(TA_WRITE_RETRY_DELAYS_MS.length + 2);
  });

  it("uses the TA another instance stored when AFIP refuses a second login", async () => {
    h.login = "alreadyAuthenticated";
    h.reads.push({ data: null, error: null });
    h.stored = {
      token: "OTHER",
      sign: "S",
      expiration_time: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    };
    const ta = await getAccessTicket("already-authenticated");
    expect(ta.token).toBe("OTHER");
  });

  it("fails retriably when AFIP refuses a second login and no TA is stored", async () => {
    h.login = "alreadyAuthenticated";
    await expect(
      getAccessTicket("already-authenticated-lost"),
    ).rejects.toBeInstanceOf(AfipTransportError);
  });
});
