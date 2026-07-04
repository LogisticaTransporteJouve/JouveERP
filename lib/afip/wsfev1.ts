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

// Escape user-controlled string values before interpolating into the SOAP
// envelope. DocNro is the only free-text field; a stray `<`/`&` would produce a
// malformed request (numbering poison) or, worst case, XML injection.
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildFECAEDetRequest(input: InvoiceRequestInput): string {
  const lines: string[] = [];
  lines.push(`<fe:Concepto>${input.concepto}</fe:Concepto>`);
  lines.push(`<fe:DocTipo>${input.docTipo}</fe:DocTipo>`);
  lines.push(`<fe:DocNro>${xmlEscape(String(input.docNro))}</fe:DocNro>`);
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

// ---------------------------------------------------------------------------
// CAEA — contingency emission (RG 5782/2025). One code per fortnight covers
// every CAEA point of sale of the CUIT; vouchers issued under it are informed
// afterwards (FECAEARegInformativo) until FchTopeInf.
// ---------------------------------------------------------------------------

export interface CaeaResult {
  caea: string;
  periodo: number;
  orden: number;
  fchVigDesde: string; // yyyymmdd
  fchVigHasta: string; // yyyymmdd
  fchTopeInf: string; // yyyymmdd
  fchProceso: string | null;
  observaciones: InvoiceObservation[];
}

interface RawCaeaGet {
  CAEA?: string | number;
  Periodo?: number;
  Orden?: number;
  FchVigDesde?: string | number;
  FchVigHasta?: string | number;
  FchTopeInf?: string | number;
  FchProceso?: string | number;
  Observaciones?: { Obs?: RawObs | RawObs[] };
}

interface ParsedCaeaGetResponse {
  Envelope?: {
    Body?: {
      [key: string]:
        | {
            [key: string]: {
              ResultGet?: RawCaeaGet;
              Errors?: { Err?: RawError | RawError[] };
            };
          }
        | SoapFault
        | undefined;
      Fault?: SoapFault;
    };
  };
}

function parseCaeaGet(
  raw: unknown,
  responseKey: string,
  resultKey: string,
): CaeaResult {
  const r = raw as ParsedCaeaGetResponse;
  detectSoapFault(r.Envelope?.Body?.Fault);
  const response = r.Envelope?.Body?.[responseKey] as
    | Record<
        string,
        { ResultGet?: RawCaeaGet; Errors?: { Err?: RawError | RawError[] } }
      >
    | undefined;
  const result = response?.[resultKey];
  detectServiceErrors(result?.Errors?.Err);
  const get = result?.ResultGet;
  if (!get?.CAEA) {
    throw new AfipServiceError([
      { code: 0, message: "AFIP no devolvió el CAEA." },
    ]);
  }
  return {
    caea: String(get.CAEA),
    periodo: Number(get.Periodo ?? 0),
    orden: Number(get.Orden ?? 0),
    fchVigDesde: String(get.FchVigDesde ?? ""),
    fchVigHasta: String(get.FchVigHasta ?? ""),
    fchTopeInf: String(get.FchTopeInf ?? ""),
    fchProceso: get.FchProceso ? String(get.FchProceso) : null,
    observaciones: parseObservations(get.Observaciones),
  };
}

/** FECAEASolicitar — requests the fortnight's CAEA (window: 5 days before the
 *  quincena starts until its last day). 15008 = already granted → consultCAEA. */
export async function requestCAEA(
  periodo: number,
  orden: 1 | 2,
): Promise<CaeaResult> {
  const ta = await getAccessTicket(WSFE_SERVICE_ID);
  const cuit = getAfipCuit();
  const inner = `<fe:FECAEASolicitar>
    ${authBlock(ta.token, ta.sign, cuit)}
    <fe:Periodo>${periodo}</fe:Periodo>
    <fe:Orden>${orden}</fe:Orden>
  </fe:FECAEASolicitar>`;

  return callWsfev1("FECAEASolicitar", inner, (raw) =>
    parseCaeaGet(raw, "FECAEASolicitarResponse", "FECAEASolicitarResult"),
  );
}

/** FECAEAConsultar — re-fetches an already-assigned CAEA (recovery for 15008). */
export async function consultCAEA(
  periodo: number,
  orden: 1 | 2,
): Promise<CaeaResult> {
  const ta = await getAccessTicket(WSFE_SERVICE_ID);
  const cuit = getAfipCuit();
  const inner = `<fe:FECAEAConsultar>
    ${authBlock(ta.token, ta.sign, cuit)}
    <fe:Periodo>${periodo}</fe:Periodo>
    <fe:Orden>${orden}</fe:Orden>
  </fe:FECAEAConsultar>`;

  return callWsfev1("FECAEAConsultar", inner, (raw) =>
    parseCaeaGet(raw, "FECAEAConsultarResponse", "FECAEAConsultarResult"),
  );
}

export interface CaeaInformInput extends InvoiceRequestInput {
  caea: string;
  /** Generation timestamp yyyymmddhhmiss (mandatory on contingency PVs, 1440). */
  cbteFchHsGen: string;
}

export interface CaeaInformResult {
  ptoVta: number;
  cbteTipo: number;
  cbteNro: number;
  caea: string;
  observaciones: InvoiceObservation[];
}

interface RawCaeaDetResp extends RawCAEDetResp {
  CAEA?: string | number;
}

interface ParsedCaeaRegInformativoResponse {
  Envelope?: {
    Body?: {
      FECAEARegInformativoResponse?: {
        FECAEARegInformativoResult?: {
          FeCabResp?: RawCAEFeCabResp;
          FeDetResp?: { FECAEADetResponse?: RawCaeaDetResp | RawCaeaDetResp[] };
          Errors?: { Err?: RawError | RawError[] };
        };
      };
      Fault?: SoapFault;
    };
  };
}

/**
 * FECAEARegInformativo — informs ONE voucher issued offline under a CAEA.
 * Same detail as FECAESolicitar plus CAEA + CbteFchHsGen (WSDL order: both go
 * after the base fields). Throws AfipServiceError when AFIP rejects it.
 */
export async function informCaeaVoucher(
  input: CaeaInformInput,
): Promise<CaeaInformResult> {
  const ta = await getAccessTicket(WSFE_SERVICE_ID);
  const cuit = getAfipCuit();
  const det = buildFECAEDetRequest(input).replace(
    "</fe:FECAEDetRequest>",
    `<fe:CAEA>${input.caea}</fe:CAEA><fe:CbteFchHsGen>${input.cbteFchHsGen}</fe:CbteFchHsGen></fe:FECAEDetRequest>`,
  );
  const inner = `<fe:FECAEARegInformativo>
    ${authBlock(ta.token, ta.sign, cuit)}
    <fe:FeCAEARegInfReq>
      <fe:FeCabReq>
        <fe:CantReg>1</fe:CantReg>
        <fe:PtoVta>${input.ptoVta}</fe:PtoVta>
        <fe:CbteTipo>${input.cbteTipo}</fe:CbteTipo>
      </fe:FeCabReq>
      <fe:FeDetReq>
        ${det.replace(/fe:FECAEDetRequest/g, "fe:FECAEADetRequest")}
      </fe:FeDetReq>
    </fe:FeCAEARegInfReq>
  </fe:FECAEARegInformativo>`;

  return callWsfev1("FECAEARegInformativo", inner, (raw) => {
    const r = raw as ParsedCaeaRegInformativoResponse;
    detectSoapFault(r.Envelope?.Body?.Fault);
    const result =
      r.Envelope?.Body?.FECAEARegInformativoResponse
        ?.FECAEARegInformativoResult;
    detectServiceErrors(result?.Errors?.Err);

    const det = pickFirstDet(result?.FeDetResp?.FECAEADetResponse);
    if (!det) {
      throw new AfipServiceError([
        { code: 0, message: "AFIP no devolvió FECAEADetResponse." },
      ]);
    }
    if (det.Resultado !== "A") {
      const obs = parseObservations(det.Observaciones);
      throw new AfipServiceError(
        obs.length > 0
          ? obs
          : [
              {
                code: 0,
                message: `AFIP rechazó el informe CAEA (Resultado=${det.Resultado ?? "?"}).`,
              },
            ],
      );
    }
    return {
      ptoVta: Number(result?.FeCabResp?.PtoVta ?? input.ptoVta),
      cbteTipo: Number(result?.FeCabResp?.CbteTipo ?? input.cbteTipo),
      cbteNro: Number(det.CbteDesde ?? input.cbteNro),
      caea: String((det as RawCaeaDetResp).CAEA ?? input.caea),
      observaciones: parseObservations(det.Observaciones),
    };
  });
}

interface ParsedCaeaSinMovResponse {
  Envelope?: {
    Body?: {
      FECAEASinMovimientoInformarResponse?: {
        FECAEASinMovimientoInformarResult?: {
          CAEA?: string | number;
          FchProceso?: string | number;
          Resultado?: string;
          PtoVta?: number;
          Errors?: { Err?: RawError | RawError[] };
        };
      };
      Fault?: SoapFault;
    };
  };
}

/** 1209 — "ya informado sin movimiento": idempotent no-op for the caller. */
export const CAEA_NO_MOVEMENT_ALREADY_INFORMED = 1209;

/** FECAEASinMovimientoInformar — declares a CAEA PV issued nothing under a CAEA. */
export async function informCaeaNoMovement(
  ptoVta: number,
  caea: string,
): Promise<{ resultado: string }> {
  const ta = await getAccessTicket(WSFE_SERVICE_ID);
  const cuit = getAfipCuit();
  const inner = `<fe:FECAEASinMovimientoInformar>
    ${authBlock(ta.token, ta.sign, cuit)}
    <fe:PtoVta>${ptoVta}</fe:PtoVta>
    <fe:CAEA>${caea}</fe:CAEA>
  </fe:FECAEASinMovimientoInformar>`;

  return callWsfev1("FECAEASinMovimientoInformar", inner, (raw) => {
    const r = raw as ParsedCaeaSinMovResponse;
    detectSoapFault(r.Envelope?.Body?.Fault);
    const result =
      r.Envelope?.Body?.FECAEASinMovimientoInformarResponse
        ?.FECAEASinMovimientoInformarResult;
    detectServiceErrors(result?.Errors?.Err);
    return { resultado: String(result?.Resultado ?? "?") };
  });
}

// Exposed for unit tests — lets us round-trip the parser without standing up
// a real SOAP endpoint.
export const __test_parsers__ = {
  buildFECAEDetRequest,
  toAfipDate,
  fmtMoney,
  parseObservations,
  parseCaeaGet,
};
