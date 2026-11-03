import "server-only";

// WSAA (Web Service de Autenticación y Autorización) client.
//
// Flow:
//   1. Build a LoginTicketRequest XML with timestamps and target service.
//   2. Sign it as CMS PKCS#7 with the AFIP cert + private key (SHA-1 —
//      AFIP's legacy implementation rejects SHA-256).
//   3. POST the base64-encoded CMS to the WSAA endpoint via SOAP envelope.
//   4. Parse the returned XML to extract { token, sign, expirationTime }.
//   5. Cache per service in memory (hot path) and DB (cold path).
//
// AFIP issues TAs valid for 12h. Asking for a new TA while one is still
// active returns `coe.alreadyAuthenticated`, so caching is mandatory.
//
// The DB cache uses the service-role Supabase client to bypass RLS — these
// rows hold credentials that authenticated users must NOT read.

import { constants, createPrivateKey, privateEncrypt } from "node:crypto";

import forge from "node-forge";

import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { getAfipCert, getAfipKey, getWsaaUrl } from "./env";
import { AfipTransportError } from "./errors";
import { afipFetch } from "./http";
import type { AccessTicket } from "./types";

/** WSAA refused a login because a TA it issued is still valid. Retriable: the
 *  instance that holds it may store it in afip_ta_cache. */
export class WsaaAlreadyAuthenticatedError extends AfipTransportError {
  constructor() {
    super(
      "AFIP ya emitió un ticket de acceso vigente que no está guardado: se reintenta.",
    );
    this.name = "WsaaAlreadyAuthenticatedError";
  }
}

const SAFETY_MARGIN_MS = 5 * 60 * 1000;

/** A TA WSAA issued after the client gave up is lost, and every later login
 *  gets `coe.alreadyAuthenticated` until it expires (12 h with no CAE), so the
 *  login waits longer than the other AFIP calls. One login per step: 60 s plus
 *  four 20 s WSFE calls stays under the 300 s step budget. */
export const WSAA_TIMEOUT_MS = 60_000;

// In-memory hot path cache. The DB cache is the source of truth.
const memCache = new Map<string, AccessTicket>();
const inFlight = new Map<string, Promise<AccessTicket>>();

function isStillValid(ta: AccessTicket): boolean {
  return ta.expiration_time.getTime() - SAFETY_MARGIN_MS > Date.now();
}

function isoWithArOffset(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const yyyy = local.getUTCFullYear();
  const mm = pad(local.getUTCMonth() + 1);
  const dd = pad(local.getUTCDate());
  const hh = pad(local.getUTCHours());
  const mi = pad(local.getUTCMinutes());
  const ss = pad(local.getUTCSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`;
}

function buildLoginTicketRequest(service: string): string {
  const now = new Date();
  const generationTime = new Date(now.getTime() - 5 * 60 * 1000);
  const expirationTime = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const uniqueId = Math.floor(now.getTime() / 1000);

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${isoWithArOffset(generationTime)}</generationTime>
    <expirationTime>${isoWithArOffset(expirationTime)}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;
}

// Literal OIDs: forge.pki.oids is typed as a possibly-undefined lookup.
const OID = {
  sha1: "1.3.14.3.2.26",
  data: "1.2.840.113549.1.7.1",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
} as const;

// DER prefix of a SHA-1 DigestInfo; the digest bytes follow it.
const SHA1_DIGEST_INFO_PREFIX = Buffer.from(
  "3021300906052b0e03021a05000414",
  "hex",
);

// Sign the LoginTicketRequest XML as CMS PKCS#7 (SignedData, content
// attached, DER, base64). AFIP's WSAA requires a SHA-1 digest — SHA-256
// returns cms.sign.invalid. Built in-process because the serverless runtime's
// `openssl` binary is not usable (it fails on a libssl symbol lookup). forge
// assembles the CMS, but the RSA signature comes from node:crypto: forge
// 1.4.2's own RSA signing yields signatures that do not verify for our keys.
export function signCms(xml: string, certPem: string, keyPem: string): string {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(xml, "utf8");
  const certificate = forge.pki.certificateFromPem(certPem);
  p7.addCertificate(certificate);
  const key = forge.pki.privateKeyFromPem(keyPem);
  const nodeKey = createPrivateKey(keyPem);
  key.sign = (md) =>
    privateEncrypt(
      { key: nodeKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.concat([
        SHA1_DIGEST_INFO_PREFIX,
        Buffer.from(
          typeof md === "string" ? md : md.digest().getBytes(),
          "binary",
        ),
      ]),
    ).toString("binary");
  p7.addSigner({
    key,
    certificate,
    digestAlgorithm: OID.sha1,
    authenticatedAttributes: [
      { type: OID.contentType, value: OID.data },
      { type: OID.messageDigest },
      // forge stamps the current time when no value is given.
      { type: OID.signingTime },
    ],
  });
  p7.sign();
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const match = xml.match(re);
  return match?.[1] ? match[1].trim() : null;
}

const WSAA_SERVICE_NS = "http://wsaahomo.afip.gov.ar/ws/services/LoginCms";

async function callWsaa(cms: string): Promise<AccessTicket> {
  const wsaaUrl = getWsaaUrl();
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:login="${WSAA_SERVICE_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <login:LoginCms>
      <login:in0>${cms}</login:in0>
    </login:LoginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  logger.debug("wsaa.request", { url: wsaaUrl, cms_length: cms.length });

  const res = await afipFetch(wsaaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      SOAPAction: WSAA_SERVICE_NS,
    },
    body: envelope,
    timeoutMs: WSAA_TIMEOUT_MS,
  });

  const text = res.text;
  logger.debug("wsaa.response", { status: res.status });

  if (!res.ok) {
    logger.warn("wsaa.http_error", {
      status: res.status,
      body: text.slice(0, 800),
    });
    if (text.includes("alreadyAuthenticated")) {
      throw new WsaaAlreadyAuthenticatedError();
    }
    throw new Error(`WSAA HTTP ${res.status}: ${text.slice(0, 800)}`);
  }

  const inner =
    extractTag(text, "LoginCmsReturn") ?? extractTag(text, "loginCmsReturn");
  if (!inner) {
    logger.error("wsaa.no_login_cms_return", { body: text.slice(0, 500) });
    throw new Error(`WSAA returned no LoginCmsReturn: ${text.slice(0, 500)}`);
  }

  const decoded = inner
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

  const token = extractTag(decoded, "token");
  const sign = extractTag(decoded, "sign");
  const expirationTime = extractTag(decoded, "expirationTime");
  if (!token || !sign || !expirationTime) {
    throw new Error(`Invalid TA response: ${decoded.slice(0, 500)}`);
  }

  return {
    token,
    sign,
    expiration_time: new Date(expirationTime),
  };
}

async function readTaFromDb(service: string): Promise<AccessTicket | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("afip_ta_cache")
    .select("token, sign, expiration_time")
    .eq("service", service)
    .maybeSingle();

  if (error) {
    // Not "no TA": a fresh login while another instance's TA is valid gets
    // alreadyAuthenticated. Retriable, like a network failure.
    logger.warn("wsaa.db_cache_read_failed", { service, err: error.message });
    throw new AfipTransportError(
      `No se pudo leer el ticket de acceso de AFIP guardado: ${error.message}`,
    );
  }
  if (!data) return null;

  // Strip any whitespace inside the base64 strings — defends against
  // accidental line breaks introduced by manual SQL pastes.
  return {
    token: data.token.replace(/\s/g, ""),
    sign: data.sign.replace(/\s/g, ""),
    expiration_time: new Date(data.expiration_time),
  };
}

/** Waits between upsert tries of a fresh TA. */
export const TA_WRITE_RETRY_DELAYS_MS = [200, 600];

/** Stores the TA for the other instances, retrying a failed upsert. Throws
 *  (retriable) when it cannot: a TA only this instance holds leaves every
 *  other one with alreadyAuthenticated until it expires. */
async function writeTaToDb(service: string, ta: AccessTicket): Promise<void> {
  const supabase = getServiceClient();
  let lastError = "";
  for (let i = 0; i <= TA_WRITE_RETRY_DELAYS_MS.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, TA_WRITE_RETRY_DELAYS_MS[i - 1]));
    }
    const { error } = await supabase.from("afip_ta_cache").upsert(
      {
        service,
        token: ta.token,
        sign: ta.sign,
        expiration_time: ta.expiration_time.toISOString(),
        cached_at: new Date().toISOString(),
      },
      { onConflict: "service" },
    );
    if (!error) return;
    lastError = error.message;
    logger.warn("wsaa.db_cache_write_failed", {
      service,
      try: i + 1,
      err: lastError,
    });
  }
  throw new AfipTransportError(
    `No se pudo guardar el ticket de acceso de AFIP: ${lastError}`,
  );
}

/** Services whose in-memory TA has not reached afip_ta_cache yet. */
const unpersisted = new Set<string>();

async function persist(service: string, ta: AccessTicket): Promise<void> {
  await writeTaToDb(service, ta);
  unpersisted.delete(service);
}

export async function getAccessTicket(service: string): Promise<AccessTicket> {
  const mem = memCache.get(service);
  if (mem && isStillValid(mem)) {
    if (unpersisted.has(service)) await persist(service, mem);
    return mem;
  }

  // Coalesce concurrent calls for the same service.
  const flight = inFlight.get(service);
  if (flight) return flight;

  const promise = (async () => {
    try {
      const dbTa = await readTaFromDb(service);
      if (dbTa && isStillValid(dbTa)) {
        memCache.set(service, dbTa);
        return dbTa;
      }

      logger.info("wsaa.requesting_fresh_ta", { service });
      const xml = buildLoginTicketRequest(service);
      const cms = signCms(xml, getAfipCert(), getAfipKey());
      let ta: AccessTicket;
      try {
        ta = await callWsaa(cms);
      } catch (err) {
        if (!(err instanceof WsaaAlreadyAuthenticatedError)) throw err;
        // Another instance logged in since the read: its TA may be stored now.
        const stored = await readTaFromDb(service);
        if (stored && isStillValid(stored)) {
          memCache.set(service, stored);
          return stored;
        }
        throw err;
      }
      // Kept in memory first: a failed write must not lose a TA AFIP will
      // not issue again; the next call retries the write.
      memCache.set(service, ta);
      unpersisted.add(service);
      await persist(service, ta);
      return ta;
    } finally {
      inFlight.delete(service);
    }
  })();

  inFlight.set(service, promise);
  return promise;
}
