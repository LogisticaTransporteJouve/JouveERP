import "server-only";

// AFIP Padrón A4 SOAP client.
//
// Calls personaServiceA4 with a manual SOAP envelope (no WSDL parsing or
// `soap` runtime dependency — the request shape is fixed and AFIP is unlikely
// to break compatibility). Response is parsed with fast-xml-parser into the
// normalized ContributorInfo shape used by the rest of the app.
//
// Pre-requisite: the AFIP_CUIT user must be subscribed to "ws_sr_padron_a4"
// in the AFIP portal (Administrador de Relaciones de Clave Fiscal → Nuevas
// relaciones).

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
  estado?: string;
  ffInscripcion?: string;
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
const EXEMPT_TAX_ID = 4;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// Map AFIP tax registrations → our IVA enum.
// Priority: VAT (responsable_inscripto) > Monotax > Exempt > no_categorizado.
export function mapTaxCondition(taxes: RawTax[]): TaxCondition {
  const isActive = (t: RawTax) => t.estado === "ACTIVO";
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
  if (taxes.some((t) => t.idImpuesto === EXEMPT_TAX_ID && isActive(t))) {
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
    status: t.estado ?? "UNKNOWN",
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
    ? "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA4"
    : "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA4";
}

const PADRON_NS = "http://a4.soap.ws.server.puc.sr/";

function buildPadronEnvelope(args: {
  token: string;
  sign: string;
  cuitRepresentada: string;
  idPersona: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a4="${PADRON_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <a4:getPersona>
      <token>${args.token}</token>
      <sign>${args.sign}</sign>
      <cuitRepresentada>${args.cuitRepresentada}</cuitRepresentada>
      <idPersona>${args.idPersona}</idPersona>
    </a4:getPersona>
  </soapenv:Body>
</soapenv:Envelope>`;
}

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: true,
});

interface ParsedPadronResponse {
  Envelope?: {
    Body?: {
      getPersonaResponse?: {
        personaReturn?: {
          persona?: RawPersona;
        };
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

  const ta = await getAccessTicket("ws_sr_padron_a4");
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
  if (!res.ok) {
    logger.warn("padron.http_error", {
      status: res.status,
      body: text.slice(0, 500),
    });
    throw new Error(`Padrón HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const parsed = xmlParser.parse(text) as ParsedPadronResponse;
  const fault = parsed.Envelope?.Body?.Fault;
  if (fault) {
    throw new Error(`Padrón fault: ${fault.faultstring ?? "unknown"}`);
  }

  const persona =
    parsed.Envelope?.Body?.getPersonaResponse?.personaReturn?.persona;
  if (!persona) {
    throw new Error(`CUIT ${cuitClean} no encontrado en padrón AFIP A4.`);
  }

  return { ...normalizePersona(persona), cuit: cuitClean };
}
