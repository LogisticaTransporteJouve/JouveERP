import "server-only";

import { Agent, fetch } from "undici";

// AFIP's production WSFE (servicios1.afip.gov.ar) still negotiates a 1024-bit
// Diffie-Hellman key, which Node's default OpenSSL security level rejects
// (ERR_SSL_DH_KEY_TOO_SMALL). SECLEVEL=1 accepts it; homologación never
// needed this, so it only surfaces in production.
const afipAgent = new Agent({ connect: { ciphers: "DEFAULT:@SECLEVEL=1" } });

export function afipFetch(
  url: string,
  init: {
    method: "POST" | "GET";
    headers?: Record<string, string>;
    body?: string;
  },
) {
  return fetch(url, { ...init, dispatcher: afipAgent });
}
