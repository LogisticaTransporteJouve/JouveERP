import "server-only";

// Health diagnostics for the AFIP integration.
//
// Each check returns a `{ status, message }` pair; the action layer
// aggregates them and exposes the result to the admin UI. Checks are run in
// parallel because most of them block on external IO (WSAA login, WSFE
// dummy). When a check fails the rest still run — that gives the admin a
// full picture instead of stopping at the first error.

import { X509Certificate } from "node:crypto";

import { getAccessTicket } from "./wsaa";
import { getAfipEnv, type AfipEnv } from "./env";
import { getServerStatus } from "./wsfev1";

export type DiagnosticStatus = "ok" | "warn" | "error";

export interface DiagnosticEntry {
  id: string;
  label: string;
  status: DiagnosticStatus;
  message: string;
}

export interface AfipDiagnostics {
  env: AfipEnv;
  entries: DiagnosticEntry[];
}

const REQUIRED_ENV = ["AFIP_ENV", "AFIP_CUIT", "AFIP_CERT", "AFIP_KEY"] as const;

function checkEnvVars(): DiagnosticEntry {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length === 0) {
    return {
      id: "env",
      label: "Variables de entorno",
      status: "ok",
      message: "AFIP_ENV, AFIP_CUIT, AFIP_CERT y AFIP_KEY presentes.",
    };
  }
  return {
    id: "env",
    label: "Variables de entorno",
    status: "error",
    message: `Faltan: ${missing.join(", ")}.`,
  };
}

function checkCertificate(): DiagnosticEntry {
  const raw = process.env.AFIP_CERT;
  if (!raw) {
    return {
      id: "cert",
      label: "Certificado",
      status: "error",
      message: "AFIP_CERT no está definido.",
    };
  }

  try {
    const pem = Buffer.from(raw, "base64").toString("utf-8");
    const cert = new X509Certificate(pem);
    const validTo = new Date(cert.validTo);
    const daysLeft = Math.floor(
      (validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );

    if (daysLeft < 0) {
      return {
        id: "cert",
        label: "Certificado",
        status: "error",
        message: `Vencido el ${validTo.toISOString().slice(0, 10)}. Renovalo en el portal AFIP.`,
      };
    }
    if (daysLeft < 30) {
      return {
        id: "cert",
        label: "Certificado",
        status: "warn",
        message: `Vence en ${daysLeft} días (${validTo.toISOString().slice(0, 10)}). Conviene renovar.`,
      };
    }
    return {
      id: "cert",
      label: "Certificado",
      status: "ok",
      message: `Vigente. Vence en ${daysLeft} días (${validTo.toISOString().slice(0, 10)}).`,
    };
  } catch (err) {
    return {
      id: "cert",
      label: "Certificado",
      status: "error",
      message:
        err instanceof Error
          ? `No se pudo parsear el PEM: ${err.message}`
          : "No se pudo parsear el PEM.",
    };
  }
}

async function checkWsaaSubscription(
  service: string,
  label: string,
): Promise<DiagnosticEntry> {
  try {
    const ta = await getAccessTicket(service);
    const expiresAt = ta.expiration_time;
    return {
      id: `wsaa:${service}`,
      label,
      status: "ok",
      message: `Ticket válido hasta ${expiresAt.toISOString().slice(0, 19).replace("T", " ")}.`,
    };
  } catch (err) {
    return {
      id: `wsaa:${service}`,
      label,
      status: "error",
      message:
        err instanceof Error
          ? err.message
          : "No se pudo obtener el ticket de acceso.",
    };
  }
}

async function checkWsfev1Dummy(): Promise<DiagnosticEntry> {
  try {
    const status = await getServerStatus();
    const allOk = [
      status.appServer,
      status.dbServer,
      status.authServer,
    ].every((s) => s.toUpperCase() === "OK");
    return {
      id: "wsfev1:dummy",
      label: "WSFEv1 — FEDummy",
      status: allOk ? "ok" : "warn",
      message: `App: ${status.appServer} · DB: ${status.dbServer} · Auth: ${status.authServer}`,
    };
  } catch (err) {
    return {
      id: "wsfev1:dummy",
      label: "WSFEv1 — FEDummy",
      status: "error",
      message:
        err instanceof Error
          ? err.message
          : "El servidor WSFEv1 no respondió.",
    };
  }
}

export async function runAfipDiagnostics(): Promise<AfipDiagnostics> {
  const env = getAfipEnv();

  const envEntry = checkEnvVars();
  const certEntry = checkCertificate();

  // Skip live calls if env or cert are broken — they would just fail with a
  // confusing message about the underlying problem.
  if (envEntry.status === "error" || certEntry.status === "error") {
    return {
      env,
      entries: [
        envEntry,
        certEntry,
        {
          id: "wsaa:wsfe",
          label: "WSAA — wsfe",
          status: "warn",
          message: "Pendiente: revisá variables y certificado primero.",
        },
        {
          id: "wsaa:ws_sr_padron_a4",
          label: "WSAA — ws_sr_padron_a4",
          status: "warn",
          message: "Pendiente: revisá variables y certificado primero.",
        },
        {
          id: "wsfev1:dummy",
          label: "WSFEv1 — FEDummy",
          status: "warn",
          message: "Pendiente: revisá variables y certificado primero.",
        },
      ],
    };
  }

  const [wsfeTa, padronTa, dummy] = await Promise.all([
    checkWsaaSubscription("wsfe", "WSAA — wsfe"),
    checkWsaaSubscription("ws_sr_padron_a4", "WSAA — ws_sr_padron_a4"),
    checkWsfev1Dummy(),
  ]);

  return {
    env,
    entries: [envEntry, certEntry, wsfeTa, padronTa, dummy],
  };
}
