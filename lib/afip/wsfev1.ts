import "server-only";

// WSFEv1 (Factura Electrónica) SOAP client.
//
// Exports:
//   - getServerStatus            → FEDummy. Health-check before emitting.
//   - getSalesPoints             → FEParamGetPtosVenta. Lists POS for this CUIT.
//   - getLastAuthorizedNumber    → FECompUltimoAutorizado. Returns last assigned
//                                  number for (PtoVta, CbteTipo). Next = +1.
//   - requestCAE                 → FECAESolicitar. Emits ONE comprobante and
//                                  returns the CAE. Throws AfipServiceError on
//                                  Resultado != 'A'.
//   - getVoucherInfo             → FECompConsultar. Recovery path: returns the
//                                  comprobante if AFIP already registered it,
//                                  null on 602 (no existe).
//
// The SOAP envelope is built manually because the request shape is fixed and
// pulling in a WSDL parser at runtime is overkill. Responses go through
// fast-xml-parser with `parseTagValue: true` so numeric leaves come back as
// numbers — but parsing remains defensive (Number(...), String(...)) because
// AFIP occasionally returns "00000" in places where you'd expect "0".
//
// Pre-requisite: AFIP_CUIT must be subscribed to "wsfe" in
// "Administrador de Relaciones de Clave Fiscal".

import { XMLParser } from "fast-xml-parser";

import { logger } from "@/lib/logger";

import type {
  CbteTipoCode,
  CondicionIvaReceptorCode,
  ConceptoCode,
  DocTipoCode,
  IvaRateId,
  MonedaCode,
} from "./codes";
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

// ---------------------------------------------------------------------------
// Emission helpers
// ---------------------------------------------------------------------------

export interface InvoiceCbteAsoc {
  tipo: CbteTipoCode;
  ptoVta: number;
  nro: number;
}

export interface InvoiceIvaEntry {
  id: IvaRateId;
  baseImp: number;
  importe: number;
}

export interface InvoiceRequestInput {
  ptoVta: number;
  cbteTipo: CbteTipoCode;
  cbteNro: number;
  fecha: string; // YYYY-MM-DD
  concepto: ConceptoCode;
  docTipo: DocTipoCode;
  docNro: string;
  impTotal: number;
  impNeto: number;
  impIva: number;
  impTotConc: number;
  impOpEx: number;
  impTrib: number;
  monId: MonedaCode;
  monCotiz: number;
  condicionIvaReceptorId: CondicionIvaReceptorCode;
  fchServDesde?: string | null;
  fchServHasta?: string | null;
  fchVtoPago?: string | null;
  iva?: InvoiceIvaEntry[];
  cbtesAsoc?: InvoiceCbteAsoc[];
}

export interface InvoiceObservation {
  code: number;
  message: string;
}

export interface InvoiceCAEResult {
  ptoVta: number;
  cbteTipo: number;
  cbteNro: number;
  cae: string;
  caeFchVto: string;
  observaciones: InvoiceObservation[];
  fchProceso: string | null;
}

export interface VoucherInfo {
  ptoVta: number;
  cbteTipo: number;
  cbteNro: number;
  cbteFch: string;
  impTotal: number;
  cae: string | null;
  caeFchVto: string | null;
  emisionTipo: string | null;
}

interface RawObs {
  Code?: number | string;
  Msg?: string;
}

interface RawCAEDetResp {
  Concepto?: number;
  DocTipo?: number;
  DocNro?: string | number;
  CbteDesde?: number | string;
  CbteHasta?: number | string;
  CbteFch?: number | string;
  Resultado?: string;
  CAE?: string | number;
  CAEFchVto?: string | number;
  Observaciones?: { Obs?: RawObs | RawObs[] };
}

interface RawCAEFeCabResp {
  Cuit?: string | number;
  PtoVta?: number;
  CbteTipo?: number;
  FchProceso?: string | number;
  CantReg?: number;
  Resultado?: string;
  Reproceso?: string;
}

interface ParsedCAESolicitarResponse {
  Envelope?: {
    Body?: {
      FECAESolicitarResponse?: {
        FECAESolicitarResult?: {
          FeCabResp?: RawCAEFeCabResp;
          FeDetResp?: { FECAEDetResponse?: RawCAEDetResp | RawCAEDetResp[] };
          Errors?: { Err?: RawError | RawError[] };
        };
      };
      Fault?: SoapFault;
    };
  };
}

interface ParsedUltimoAutorizadoResponse {
  Envelope?: {
    Body?: {
      FECompUltimoAutorizadoResponse?: {
        FECompUltimoAutorizadoResult?: {
          PtoVta?: number;
          CbteTipo?: number;
          CbteNro?: number | string;
          Errors?: { Err?: RawError | RawError[] };
        };
      };
      Fault?: SoapFault;
    };
  };
}

interface RawCompConsultarResultGet {
  Concepto?: number;
  DocTipo?: number;
  DocNro?: string | number;
  CbteDesde?: number | string;
  CbteHasta?: number | string;
  CbteFch?: string | number;
  ImpTotal?: number | string;
  ImpNeto?: number | string;
  ImpIVA?: number | string;
  PtoVta?: number;
  CbteTipo?: number;
  CodAutorizacion?: string | number;
  FchVto?: string | number;
  EmisionTipo?: string;
  Resultado?: string;
}

interface ParsedCompConsultarResponse {
  Envelope?: {
    Body?: {
      FECompConsultarResponse?: {
        FECompConsultarResult?: {
          ResultGet?: RawCompConsultarResultGet;
          Errors?: { Err?: RawError | RawError[] };
        };
      };
      Fault?: SoapFault;
    };
  };
}

const NO_EXISTE_CODE = 602;

function toAfipDate(iso: string): string {
  return iso.replace(/-/g, "");
}

function fmtMoney(n: number): string {
  return n.toFixed(2);
}

function buildFECAEDetRequest(input: InvoiceRequestInput): string {
  const lines: string[] = [];
  lines.push(`<fe:Concepto>${input.concepto}</fe:Concepto>`);
  lines.push(`<fe:DocTipo>${input.docTipo}</fe:DocTipo>`);
  lines.push(`<fe:DocNro>${input.docNro}</fe:DocNro>`);
  lines.push(`<fe:CbteDesde>${input.cbteNro}</fe:CbteDesde>`);
  lines.push(`<fe:CbteHasta>${input.cbteNro}</fe:CbteHasta>`);
  lines.push(`<fe:CbteFch>${toAfipDate(input.fecha)}</fe:CbteFch>`);
  lines.push(`<fe:ImpTotal>${fmtMoney(input.impTotal)}</fe:ImpTotal>`);
  lines.push(`<fe:ImpTotConc>${fmtMoney(input.impTotConc)}</fe:ImpTotConc>`);
  lines.push(`<fe:ImpNeto>${fmtMoney(input.impNeto)}</fe:ImpNeto>`);
  lines.push(`<fe:ImpOpEx>${fmtMoney(input.impOpEx)}</fe:ImpOpEx>`);
  lines.push(`<fe:ImpTrib>${fmtMoney(input.impTrib)}</fe:ImpTrib>`);
  lines.push(`<fe:ImpIVA>${fmtMoney(input.impIva)}</fe:ImpIVA>`);

  if (input.fchServDesde) {
    lines.push(
      `<fe:FchServDesde>${toAfipDate(input.fchServDesde)}</fe:FchServDesde>`,
    );
  }
  if (input.fchServHasta) {
    lines.push(
      `<fe:FchServHasta>${toAfipDate(input.fchServHasta)}</fe:FchServHasta>`,
    );
  }
  if (input.fchVtoPago) {
    lines.push(
      `<fe:FchVtoPago>${toAfipDate(input.fchVtoPago)}</fe:FchVtoPago>`,
    );
  }

  lines.push(`<fe:MonId>${input.monId}</fe:MonId>`);
  lines.push(`<fe:MonCotiz>${input.monCotiz}</fe:MonCotiz>`);
  lines.push(
    `<fe:CondicionIVAReceptorId>${input.condicionIvaReceptorId}</fe:CondicionIVAReceptorId>`,
  );

  if (input.cbtesAsoc && input.cbtesAsoc.length > 0) {
    const items = input.cbtesAsoc
      .map(
        (c) =>
          `<fe:CbteAsoc><fe:Tipo>${c.tipo}</fe:Tipo><fe:PtoVta>${c.ptoVta}</fe:PtoVta><fe:Nro>${c.nro}</fe:Nro></fe:CbteAsoc>`,
      )
      .join("");
    lines.push(`<fe:CbtesAsoc>${items}</fe:CbtesAsoc>`);
  }

  if (input.iva && input.iva.length > 0) {
    const items = input.iva
      .map(
        (i) =>
          `<fe:AlicIva><fe:Id>${i.id}</fe:Id><fe:BaseImp>${fmtMoney(i.baseImp)}</fe:BaseImp><fe:Importe>${fmtMoney(i.importe)}</fe:Importe></fe:AlicIva>`,
      )
      .join("");
    lines.push(`<fe:Iva>${items}</fe:Iva>`);
  }

  return `<fe:FECAEDetRequest>${lines.join("")}</fe:FECAEDetRequest>`;
}

function pickFirstDet(
  det: RawCAEDetResp | RawCAEDetResp[] | undefined,
): RawCAEDetResp | undefined {
  if (!det) return undefined;
  return Array.isArray(det) ? det[0] : det;
}

function parseObservations(
  raw: { Obs?: RawObs | RawObs[] } | undefined,
): InvoiceObservation[] {
  return asArray(raw?.Obs).map((o) => ({
    code: Number(o.Code ?? 0),
    message: String(o.Msg ?? ""),
  }));
}

export async function getLastAuthorizedNumber(
  ptoVta: number,
  cbteTipo: number,
): Promise<number> {
  const ta = await getAccessTicket(WSFE_SERVICE_ID);
  const cuit = getAfipCuit();
  const inner = `<fe:FECompUltimoAutorizado>
    ${authBlock(ta.token, ta.sign, cuit)}
    <fe:PtoVta>${ptoVta}</fe:PtoVta>
    <fe:CbteTipo>${cbteTipo}</fe:CbteTipo>
  </fe:FECompUltimoAutorizado>`;

  return callWsfev1("FECompUltimoAutorizado", inner, (raw) => {
    const r = raw as ParsedUltimoAutorizadoResponse;
    detectSoapFault(r.Envelope?.Body?.Fault);
    const result =
      r.Envelope?.Body?.FECompUltimoAutorizadoResponse
        ?.FECompUltimoAutorizadoResult;
    detectServiceErrors(result?.Errors?.Err);
    return Number(result?.CbteNro ?? 0);
  });
}

export async function requestCAE(
  input: InvoiceRequestInput,
): Promise<InvoiceCAEResult> {
  const ta = await getAccessTicket(WSFE_SERVICE_ID);
  const cuit = getAfipCuit();
  const inner = `<fe:FECAESolicitar>
    ${authBlock(ta.token, ta.sign, cuit)}
    <fe:FeCAEReq>
      <fe:FeCabReq>
        <fe:CantReg>1</fe:CantReg>
        <fe:PtoVta>${input.ptoVta}</fe:PtoVta>
        <fe:CbteTipo>${input.cbteTipo}</fe:CbteTipo>
      </fe:FeCabReq>
      <fe:FeDetReq>
        ${buildFECAEDetRequest(input)}
      </fe:FeDetReq>
    </fe:FeCAEReq>
  </fe:FECAESolicitar>`;

  return callWsfev1("FECAESolicitar", inner, (raw) => {
    const r = raw as ParsedCAESolicitarResponse;
    detectSoapFault(r.Envelope?.Body?.Fault);
    const result =
      r.Envelope?.Body?.FECAESolicitarResponse?.FECAESolicitarResult;
    detectServiceErrors(result?.Errors?.Err);

    const cab = result?.FeCabResp;
    const det = pickFirstDet(result?.FeDetResp?.FECAEDetResponse);

    if (!det) {
      throw new AfipServiceError([
        { code: 0, message: "AFIP returned no FECAEDetResponse." },
      ]);
    }

    if (det.Resultado !== "A") {
      const obs = parseObservations(det.Observaciones);
      const entries: AfipServiceErrorEntry[] =
        obs.length > 0
          ? obs
          : [
              {
                code: 0,
                message: `AFIP rechazó el comprobante (Resultado=${det.Resultado ?? "?"}).`,
              },
            ];
      throw new AfipServiceError(entries);
    }

    if (!det.CAE || !det.CAEFchVto) {
      throw new AfipServiceError([
        { code: 0, message: "AFIP aprobó pero no devolvió CAE." },
      ]);
    }

    return {
      ptoVta: Number(cab?.PtoVta ?? input.ptoVta),
      cbteTipo: Number(cab?.CbteTipo ?? input.cbteTipo),
      cbteNro: Number(det.CbteDesde ?? input.cbteNro),
      cae: String(det.CAE),
      caeFchVto: String(det.CAEFchVto),
      observaciones: parseObservations(det.Observaciones),
      fchProceso: cab?.FchProceso ? String(cab.FchProceso) : null,
    };
  });
}

export async function getVoucherInfo(
  ptoVta: number,
  cbteTipo: number,
  cbteNro: number,
): Promise<VoucherInfo | null> {
  const ta = await getAccessTicket(WSFE_SERVICE_ID);
  const cuit = getAfipCuit();
  const inner = `<fe:FECompConsultar>
    ${authBlock(ta.token, ta.sign, cuit)}
    <fe:FeCompConsReq>
      <fe:CbteTipo>${cbteTipo}</fe:CbteTipo>
      <fe:CbteNro>${cbteNro}</fe:CbteNro>
      <fe:PtoVta>${ptoVta}</fe:PtoVta>
    </fe:FeCompConsReq>
  </fe:FECompConsultar>`;

  return callWsfev1("FECompConsultar", inner, (raw) => {
    const r = raw as ParsedCompConsultarResponse;
    detectSoapFault(r.Envelope?.Body?.Fault);
    const result =
      r.Envelope?.Body?.FECompConsultarResponse?.FECompConsultarResult;

    const errors = asArray(result?.Errors?.Err);
    if (errors.length > 0) {
      const isNotFound = errors.some(
        (e) => Number(e.Code) === NO_EXISTE_CODE,
      );
      if (isNotFound) return null;
      throw new AfipServiceError(
        errors.map((e) => ({
          code: Number(e.Code ?? 0),
          message: String(e.Msg ?? ""),
        })),
      );
    }

    const res = result?.ResultGet;
    if (!res) return null;

    return {
      ptoVta: Number(res.PtoVta ?? ptoVta),
      cbteTipo: Number(res.CbteTipo ?? cbteTipo),
      cbteNro: Number(res.CbteDesde ?? cbteNro),
      cbteFch: String(res.CbteFch ?? ""),
      impTotal: Number(res.ImpTotal ?? 0),
      cae: res.CodAutorizacion ? String(res.CodAutorizacion) : null,
      caeFchVto: res.FchVto ? String(res.FchVto) : null,
      emisionTipo: res.EmisionTipo ? String(res.EmisionTipo) : null,
    };
  });
}

// Exposed for unit tests — lets us round-trip the parser without standing up
// a real SOAP endpoint.
export const __test_parsers__ = {
  buildFECAEDetRequest,
  toAfipDate,
  fmtMoney,
  parseObservations,
};
