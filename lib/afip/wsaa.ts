import "server-only";

// WSAA (Web Service de Autenticación y Autorización) client.
//
// Flow:
//   1. Build a LoginTicketRequest XML with timestamps and target service.
//   2. Sign it as CMS PKCS#7 with the AFIP cert + private key (SHA-1, no
//      signed attributes — AFIP's legacy implementation rejects modern CMS).
//   3. POST the base64-encoded CMS to the WSAA endpoint via SOAP envelope.
//   4. Parse the returned XML to extract { token, sign, expirationTime }.
//   5. Cache per service in memory (hot path) and DB (cold path).
//
// AFIP issues TAs valid for 12h. Asking for a new TA while one is still
// active returns `coe.alreadyAuthenticated`, so caching is mandatory.
//
// The DB cache uses the service-role Supabase client to bypass RLS — these
// rows hold credentials that authenticated users must NOT read.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import { getAfipCert, getAfipKey, getWsaaUrl } from "./env";
import type { AccessTicket } from "./types";

const SAFETY_MARGIN_MS = 5 * 60 * 1000;

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

// Sign the LoginTicketRequest XML as CMS PKCS#7 using OpenSSL as subprocess.
// AFIP's WSAA legacy implementation requires:
//   - SHA-1 digest (SHA-256 returns cms.sign.invalid)
//   - No signed attributes
//   - DER-encoded output, base64 wrapped
function signCms(xml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "afip-wsaa-"));
  const xmlPath = join(dir, "ticket.xml");
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");

  try {
    writeFileSync(xmlPath, xml, "utf-8");
    writeFileSync(certPath, getAfipCert(), "utf-8");
    writeFileSync(keyPath, getAfipKey(), "utf-8");

    const der = execFileSync(
      "openssl",
      [
        "cms",
        "-sign",
        "-in",
        xmlPath,
        "-signer",
        certPath,
        "-inkey",
        keyPath,
        "-nodetach",
        "-outform",
        "DER",
        "-md",
        "sha1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    return der.toString("base64");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

  const res = await fetch(wsaaUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      SOAPAction: WSAA_SERVICE_NS,
    },
    body: envelope,
  });

  const text = await res.text();
  logger.debug("wsaa.response", { status: res.status });

  if (!res.ok) {
    logger.warn("wsaa.http_error", {
      status: res.status,
      body: text.slice(0, 800),
    });
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
    logger.warn("wsaa.db_cache_read_failed", { service, err: error.message });
    return null;
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

async function writeTaToDb(service: string, ta: AccessTicket): Promise<void> {
  const supabase = getServiceClient();
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
  if (error) {
    logger.warn("wsaa.db_cache_write_failed", {
      service,
      err: error.message,
    });
  }
}

export async function getAccessTicket(service: string): Promise<AccessTicket> {
  const mem = memCache.get(service);
  if (mem && isStillValid(mem)) return mem;

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
      const cms = signCms(xml);
      const ta = await callWsaa(cms);
      memCache.set(service, ta);
      await writeTaToDb(service, ta);
      return ta;
    } finally {
      inFlight.delete(service);
    }
  })();

  inFlight.set(service, promise);
  return promise;
}
