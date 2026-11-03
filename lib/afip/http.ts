import "server-only";

import { Agent, fetch } from "undici";

import { AfipTransportError } from "./errors";

// AFIP's production WSFE (servicios1.afip.gov.ar) still negotiates a 1024-bit
// Diffie-Hellman key, which Node's default OpenSSL security level rejects
// (ERR_SSL_DH_KEY_TOO_SMALL). SECLEVEL=1 accepts it; homologación never
// needed this, so it only surfaces in production.
const afipAgent = new Agent({ connect: { ciphers: "DEFAULT:@SECLEVEL=1" } });

/** Deadline for one AFIP request, response body included. AFIP often degrades
 *  by accepting the connection and never answering; without a deadline a call
 *  waits for undici's 300 s defaults, the whole Inngest step budget
 *  (app/api/inngest/route.ts maxDuration), so the step is killed before its
 *  own recovery (consult, CAEA fallback) runs. issue-invoice's CAE step makes
 *  at most one WSAA login (WSAA_TIMEOUT_MS, 60 s) and four WSFE calls
 *  (consult, last number, FECAESolicitar, consult): 60 + 4 × 20 s stays under
 *  300 s. */
export const AFIP_TIMEOUT_MS = 20_000;

export type AfipResponse = { ok: boolean; status: number; text: string };

/** POST/GET to an AFIP service. A network failure or a missed deadline throws
 *  AfipTransportError (the request may or may not have reached AFIP). */
export async function afipFetch(
  url: string,
  init: {
    method: "POST" | "GET";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
): Promise<AfipResponse> {
  const { timeoutMs = AFIP_TIMEOUT_MS, ...request } = init;
  try {
    const res = await fetch(url, {
      ...request,
      dispatcher: afipAgent,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (err) {
    const timedOut =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    throw new AfipTransportError(
      timedOut
        ? `AFIP no respondió en ${Math.round(timeoutMs / 1000)} s`
        : err instanceof Error
          ? err.message
          : "fetch failed",
      undefined,
      { timedOut },
    );
  }
}
