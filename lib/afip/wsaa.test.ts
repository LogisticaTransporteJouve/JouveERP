import forge from "node-forge";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient: vi.fn() }));

import { signCms } from "./wsaa";

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

describe("signCms", () => {
  it("produces an attached SHA-1 SignedData over the ticket XML", () => {
    const { certPem, keyPem } = selfSigned();
    const xml = "<loginTicketRequest>ñ</loginTicketRequest>";

    const der = forge.util.decode64(signCms(xml, certPem, keyPem));
    const asn1 = forge.asn1.fromDer(der);
    const msg = forge.pkcs7.messageFromAsn1(asn1);

    // Attached content: the UTF-8 XML travels inside the CMS.
    expect(der.includes(forge.util.encodeUtf8(xml))).toBe(true);
    expect(der.includes(forge.asn1.oidToDer("1.3.14.3.2.26").getBytes())).toBe(
      true,
    );
    expect("certificates" in msg && msg.certificates).toHaveLength(1);
  });

  it("signs so the certificate's public key verifies the signature", async () => {
    const { certPem, keyPem } = selfSigned();
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(`${tmpdir()}/cms-`);
    try {
      writeFileSync(
        `${dir}/s.der`,
        Buffer.from(signCms("<t/>", certPem, keyPem), "base64"),
      );
      writeFileSync(`${dir}/c.pem`, certPem);
      // -noverify skips the chain (self-signed); the signature itself is
      // still checked against the embedded certificate.
      const out = execFileSync("openssl", [
        "cms",
        "-verify",
        "-noverify",
        "-inform",
        "DER",
        "-in",
        `${dir}/s.der`,
        "-certfile",
        `${dir}/c.pem`,
      ]);
      expect(out.toString()).toBe("<t/>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
