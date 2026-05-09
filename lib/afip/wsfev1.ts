import "server-only";

// WSFEv1 (Factura Electrónica) SOAP client — minimal surface.
//
// This file currently exposes only the methods we need to bootstrap Phase E:
//   - getServerStatus   → FEDummy. Health-check before emitting.
//   - getSalesPoints    → FEParamGetPtosVenta. Discovers the puntos de venta
//                         registered against the AFIP_CUIT in the portal.
//
// FECompUltimoAutorizado, FECAESolicitar and FECompConsultar land in E.3
// together with the issueInvoice workflow. The plumbing here (ticket reuse,
// envelope builder, SOAP fault detection, error hierarchy) carries over.
//
// Pre-requisite: AFIP_CUIT must be subscribed to "wsfe" in
// "Administrador de Relaciones de Clave Fiscal".

import { XMLParser } from "fast-xml-parser";

import { logger } from "@/lib/logger";

import { getAfipCuit, getWsfev1Url } from "./env";
import {
  AfipServiceError,
  AfipSoapFaultError,
  AfipTransportError,
  type AfipServiceErrorEntry,
} from "./errors";
import { getAccessTicket } from "./wsaa";

const WSFE_NS = "http://ar.gov.afip.dif.FEV1/";
const WSFE_SERVICE_ID = "wsfe";

export interface SalesPoint {
  number: number;
  emissionType: string;
  blocked: boolean;
  expirationDate: string | null;
}

export interface ServerStatus {
  appServer: string;
  dbServer: string;
  authServer: string;
}

interface RawError {
  Code?: number;
  Msg?: string;
}

interface RawPtoVenta {
  Nro?: number;
  EmisionTipo?: string;
  Bloqueado?: string;
  FchBaja?: string;
}

interface SoapFault {
  faultcode?: string;
  faultstring?: string;
}

interface ParsedDummyResponse {
  Envelope?: {
    Body?: {
      FEDummyResponse?: {
        FEDummyResult?: {
          AppServer?: string;
          DbServer?: string;
          AuthServer?: string;
        };
      };
      Fault?: SoapFault;
    };
  };
}

interface ParsedPtosVentaResponse {
  Envelope?: {
    Body?: {
      FEParamGetPtosVentaResponse?: {
        FEParamGetPtosVentaResult?: {
          ResultGet?: {
            PtoVenta?: RawPtoVenta | RawPtoVenta[];
          };
          Errors?: {
            Err?: RawError | RawError[];
          };
        };
      };
      Fault?: SoapFault;
    };
  };
}

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function detectSoapFault(fault: SoapFault | undefined): never | void {
  if (!fault) return;
  throw new AfipSoapFaultError(fault.faultstring ?? "unknown", {
    code: fault.faultcode,
  });
}

function detectServiceErrors(errors: RawError | RawError[] | undefined): void {
  const list = asArray(errors);
  if (list.length === 0) return;
  const entries: AfipServiceErrorEntry[] = list.map((e) => ({
    code: e.Code ?? 0,
    message: e.Msg ?? "unknown",
  }));
  throw new AfipServiceError(entries);
}

async function callWsfev1<T>(
  action: string,
  innerXml: string,
  parse: (raw: unknown) => T,
): Promise<T> {
  const url = getWsfev1Url();
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:fe="${WSFE_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    ${innerXml}
  </soapenv:Body>
</soapenv:Envelope>`;

  logger.debug("wsfev1.request", { action });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `${WSFE_NS}${action}`,
      },
      body: envelope,
    });
  } catch (err) {
    throw new AfipTransportError(
      err instanceof Error ? err.message : "fetch failed",
    );
  }

  const text = await res.text();
  if (!res.ok) {
    logger.warn("wsfev1.http_error", {
      action,
      status: res.status,
      body: text.slice(0, 500),
    });
    throw new AfipTransportError(`HTTP ${res.status}`, res.status, {
      body: text.slice(0, 500),
    });
  }

  const parsed = xmlParser.parse(text) as unknown;
  return parse(parsed);
}

function authBlock(token: string, sign: string, cuit: string): string {
  return `<fe:Auth>
    <fe:Token>${token}</fe:Token>
    <fe:Sign>${sign}</fe:Sign>
    <fe:Cuit>${cuit}</fe:Cuit>
  </fe:Auth>`;
}

export async function getServerStatus(): Promise<ServerStatus> {
  return callWsfev1(
    "FEDummy",
    `<fe:FEDummy/>`,
    (raw) => {
      const r = raw as ParsedDummyResponse;
      detectSoapFault(r.Envelope?.Body?.Fault);
      const result = r.Envelope?.Body?.FEDummyResponse?.FEDummyResult;
      return {
        appServer: result?.AppServer ?? "UNKNOWN",
        dbServer: result?.DbServer ?? "UNKNOWN",
        authServer: result?.AuthServer ?? "UNKNOWN",
      };
    },
  );
}

export function normalizeSalesPoints(
  raw: RawPtoVenta | RawPtoVenta[] | undefined,
): SalesPoint[] {
  return asArray(raw).map((p) => ({
    number: p.Nro ?? 0,
    emissionType: p.EmisionTipo ?? "UNKNOWN",
    blocked: (p.Bloqueado ?? "N").toUpperCase() === "S",
    expirationDate:
      p.FchBaja && p.FchBaja !== "NULL" ? String(p.FchBaja) : null,
  }));
}

export async function getSalesPoints(): Promise<SalesPoint[]> {
  const ta = await getAccessTicket(WSFE_SERVICE_ID);
  const cuit = getAfipCuit();
  const inner = `<fe:FEParamGetPtosVenta>
    ${authBlock(ta.token, ta.sign, cuit)}
  </fe:FEParamGetPtosVenta>`;

  return callWsfev1("FEParamGetPtosVenta", inner, (raw) => {
    const r = raw as ParsedPtosVentaResponse;
    detectSoapFault(r.Envelope?.Body?.Fault);
    const result =
      r.Envelope?.Body?.FEParamGetPtosVentaResponse?.FEParamGetPtosVentaResult;
    detectServiceErrors(result?.Errors?.Err);
    return normalizeSalesPoints(result?.ResultGet?.PtoVenta);
  });
}
