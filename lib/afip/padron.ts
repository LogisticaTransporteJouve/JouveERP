import "server-only";

// AFIP padrón client — Constancia de Inscripción (personaServiceA5).
//
// Calls getPersona_v2 with a manual SOAP envelope (no WSDL parsing or `soap`
// runtime dependency — the request shape is fixed). The response is parsed
// with fast-xml-parser into the normalized ContributorInfo shape used by the
// rest of the app. A5 replaced A4, which ARCA no longer enables for regular
// taxpayers in production.
//
// Pre-requisite: the certificate's alias must be related to
// "ws_sr_constancia_inscripcion" (Administrador de Relaciones de Clave Fiscal
// → Nueva relación → ARCA → WebServices → Consulta de Constancia de
// Inscripción); in homologación, via WSASS.

export const PADRON_SERVICE_ID = "ws_sr_constancia_inscripcion";

import { XMLParser } from "fast-xml-parser";

import { logger } from "@/lib/logger";

import { getAccessTicket } from "./wsaa";
import { getAfipCuit, getAfipEnv } from "./env";
import type {
  ContributorInfo,
  FiscalAddress,
  TaxCondition,
  TaxEntry,
} from "./types";

interface RawTax {
  idImpuesto?: number;
  descripcionImpuesto?: string;
  /** A4 only; A5 lists active registrations without a state. */
  estado?: string;
  ffInscripcion?: string;
  periodo?: number | string;
}

interface RawAddress {
  tipoDomicilio?: string;
  direccion?: string;
  localidad?: string;
  descripcionProvincia?: string;
  codPostal?: string;
}

interface RawActivity {
  idActividad?: number;
  descripcionActividad?: string;
  orden?: number;
}

export interface RawPersona {
  tipoPersona?: "FISICA" | "JURIDICA";
  tipoClave?: "CUIT" | "CUIL" | "CDI";
  estadoClave?: string;
  razonSocial?: string;
  nombre?: string;
  apellido?: string;
  mesCierre?: number;
  fechaInscripcion?: string;
  impuesto?: RawTax | RawTax[];
  domicilio?: RawAddress | RawAddress[];
  actividad?: RawActivity | RawActivity[];
}

const VAT_TAX_ID = 30;
const MONOTAX_IDS = [20, 21];
// 32 = IVA EXENTO in the constancia; 4 kept from the A4 tax table.
const EXEMPT_TAX_IDS = [4, 32];

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// Map AFIP tax registrations → our IVA enum.
// Priority: VAT (responsable_inscripto) > Monotax > Exempt > no_categorizado.
export function mapTaxCondition(taxes: RawTax[]): TaxCondition {
  const isActive = (t: RawTax) =>
    t.estado === undefined || t.estado === "ACTIVO";
  if (taxes.some((t) => t.idImpuesto === VAT_TAX_ID && isActive(t))) {
    return "responsable_inscripto";
  }
  if (
    taxes.some(
      (t) =>
        t.idImpuesto !== undefined &&
        MONOTAX_IDS.includes(t.idImpuesto) &&
        isActive(t),
    )
  ) {
    return "monotributo";
  }
  if (
    taxes.some(
      (t) =>
        t.idImpuesto !== undefined &&
        EXEMPT_TAX_IDS.includes(t.idImpuesto) &&
        isActive(t),
    )
  ) {
    return "exento";
  }
  return "no_categorizado";
}

export function buildLegalName(p: RawPersona): string {
  if (p.razonSocial) return p.razonSocial;
  const parts = [p.apellido, p.nombre].filter(Boolean).join(", ").trim();
  return parts.replace(/^,\s*/, "");
}

export function buildAddress(addrs: RawAddress[]): FiscalAddress | null {
  if (addrs.length === 0) return null;
  const fiscal = addrs.find((a) => a.tipoDomicilio === "FISCAL") ?? addrs[0];
  if (!fiscal) return null;
  return {
    street: fiscal.direccion ?? "",
    city: fiscal.localidad ?? "",
    province: fiscal.descripcionProvincia ?? "",
    postal_code: fiscal.codPostal ?? "",
  };
}

export function buildMainActivity(acts: RawActivity[]): string | null {
  if (acts.length === 0) return null;
  const main =
    acts.find((a) => a.orden === 1) ??
    acts.slice().sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999))[0];
  return main?.descripcionActividad ?? null;
}

function normalizeStatus(raw: string | undefined): ContributorInfo["status"] {
  if (raw === "ACTIVO" || raw === "INACTIVO" || raw === "BLOQUEADO") return raw;
  return "UNKNOWN";
}

function buildTaxes(taxes: RawTax[]): TaxEntry[] {
  return taxes.map((t) => ({
    id: t.idImpuesto ?? 0,
    description: t.descripcionImpuesto ?? "",
    status: t.estado ?? "ACTIVO",
    registration_date: t.ffInscripcion ?? null,
  }));
}

export function normalizePersona(persona: RawPersona): ContributorInfo {
  const taxes = asArray(persona.impuesto);
  const addresses = asArray(persona.domicilio);
  const activities = asArray(persona.actividad);

  return {
    cuit: "", // filled by caller (we have it before parsing)
    person_type: persona.tipoPersona ?? "JURIDICA",
    id_type: persona.tipoClave ?? "CUIT",
    status: normalizeStatus(persona.estadoClave),
    legal_name: buildLegalName(persona),
    first_name: persona.nombre ?? null,
    last_name: persona.apellido ?? null,
    tax_condition: mapTaxCondition(taxes),
    fiscal_address: buildAddress(addresses),
    main_activity: buildMainActivity(activities),
    closing_month: persona.mesCierre ?? null,
    registration_date: persona.fechaInscripcion ?? null,
    taxes: buildTaxes(taxes),
  };
}

function getPadronEndpoint(): string {
  return getAfipEnv() === "prod"
    ? "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5"
    : "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5";
}

const PADRON_NS = "http://a5.soap.ws.server.puc.sr/";

function buildPadronEnvelope(args: {
  token: string;
  sign: string;
  cuitRepresentada: string;
  idPersona: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="${PADRON_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <a5:getPersona_v2>
      <token>${args.token}</token>
      <sign>${args.sign}</sign>
      <cuitRepresentada>${args.cuitRepresentada}</cuitRepresentada>
      <idPersona>${args.idPersona}</idPersona>
    </a5:getPersona_v2>
  </soapenv:Body>
</soapenv:Envelope>`;
}

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: true,
});

interface RawConstanciaErrors {
  error?: string | string[];
}

export interface RawPersonaReturn {
  datosGenerales?: {
    tipoPersona?: "FISICA" | "JURIDICA";
    tipoClave?: "CUIT" | "CUIL" | "CDI";
    estadoClave?: string;
    razonSocial?: string;
    nombre?: string;
    apellido?: string;
    mesCierre?: number;
    fechaContratoSocial?: string;
    domicilioFiscal?: RawAddress;
  };
  datosRegimenGeneral?: {
    impuesto?: RawTax | RawTax[];
    actividad?: RawActivity | RawActivity[];
  };
  datosMonotributo?: {
    impuesto?: RawTax | RawTax[];
    actividadMonotributista?: RawActivity;
  };
  errorConstancia?: RawConstanciaErrors;
}

/** Folds the constancia's sections into the flat persona shape. */
export function personaFromConstancia(ret: RawPersonaReturn): RawPersona {
  const general = ret.datosGenerales ?? {};
  return {
    tipoPersona: general.tipoPersona,
    tipoClave: general.tipoClave,
    estadoClave: general.estadoClave,
    razonSocial: general.razonSocial,
    nombre: general.nombre,
    apellido: general.apellido,
    mesCierre: general.mesCierre,
    fechaInscripcion: general.fechaContratoSocial,
    impuesto: [
      ...asArray(ret.datosRegimenGeneral?.impuesto),
      ...asArray(ret.datosMonotributo?.impuesto),
    ],
    domicilio: general.domicilioFiscal
      ? [{ ...general.domicilioFiscal, tipoDomicilio: "FISCAL" }]
      : [],
    actividad: [
      ...asArray(ret.datosRegimenGeneral?.actividad),
      ...asArray(ret.datosMonotributo?.actividadMonotributista),
    ],
  };
}

interface ParsedPadronResponse {
  Envelope?: {
    Body?: {
      getPersona_v2Response?: {
        personaReturn?: RawPersonaReturn;
      };
      Fault?: {
        faultstring?: string;
      };
    };
  };
}

export async function consultarPadron(cuit: string): Promise<ContributorInfo> {
  const cuitClean = cuit.replace(/[-\s]/g, "");
  if (!/^[23]\d{10}$/.test(cuitClean)) {
    throw new Error(
      "CUIT inválido — debe tener 11 dígitos y empezar con 2 o 3.",
    );
  }

  const ta = await getAccessTicket(PADRON_SERVICE_ID);
  logger.debug("padron.lookup", { cuit: cuitClean });

  const envelope = buildPadronEnvelope({
    token: ta.token,
    sign: ta.sign,
    cuitRepresentada: getAfipCuit(),
    idPersona: cuitClean,
  });

  const res = await fetch(getPadronEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "",
    },
    body: envelope,
  });

  const text = await res.text();
  // AFIP answers business faults ("No existe persona con ese Id") as HTTP 500
  // with a SOAP Fault body, so the fault is read before the status.
  const parsed = xmlParser.parse(text) as ParsedPadronResponse;
  const fault = parsed.Envelope?.Body?.Fault;
  if (fault) {
    throw new Error(padronFaultMessage(cuitClean, fault.faultstring));
  }
  if (!res.ok) {
    logger.warn("padron.http_error", {
      status: res.status,
      body: text.slice(0, 500),
    });
    throw new Error(
      `El padrón de AFIP no respondió (HTTP ${res.status}). Probá de nuevo en un rato.`,
    );
  }

  const ret = parsed.Envelope?.Body?.getPersona_v2Response?.personaReturn;
  if (!ret?.datosGenerales) {
    // errorConstancia carries why AFIP issues no constancia (e.g. no active
    // taxes); without datosGenerales there is nothing to build a client from.
    const reasons = asArray(ret?.errorConstancia?.error).join(" ");
    throw new Error(
      reasons
        ? `AFIP no emite constancia para el CUIT ${cuitClean}: ${reasons}`
        : `CUIT ${cuitClean} no encontrado en el padrón de AFIP.`,
    );
  }

  return { ...normalizePersona(personaFromConstancia(ret)), cuit: cuitClean };
}

export function padronFaultMessage(
  cuit: string,
  faultstring: string | undefined,
): string {
  if (faultstring && /no existe persona/i.test(faultstring)) {
    return getAfipEnv() === "homo"
      ? `El CUIT ${cuit} no está en el padrón de homologación de AFIP, que solo tiene datos de prueba.`
      : `El CUIT ${cuit} no existe en el padrón de AFIP.`;
  }
  return `El padrón de AFIP devolvió un error: ${faultstring ?? "sin detalle"}.`;
}
