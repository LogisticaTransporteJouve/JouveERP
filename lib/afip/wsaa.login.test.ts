import forge from "node-forge";
import { describe, expect, it, vi } from "vitest";

import { AFIP_TIMEOUT_MS } from "./http";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ timeoutMs?: number }>,
  certPem: "",
  keyPem: "",
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async () => ({ error: null }),
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

const { WSAA_TIMEOUT_MS, getAccessTicket } = await import("./wsaa");

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

describe("getAccessTicket", () => {
  it("waits longer for a login than for other AFIP calls: a TA issued after a client timeout is lost", async () => {
    Object.assign(h, selfSigned());
    const ta = await getAccessTicket("wsfe");
    expect(ta.token).toBe("T");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.timeoutMs).toBe(WSAA_TIMEOUT_MS);
    expect(WSAA_TIMEOUT_MS).toBeGreaterThan(AFIP_TIMEOUT_MS);
  });
});
