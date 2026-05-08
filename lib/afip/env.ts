import "server-only";

// Environment variables and endpoint URLs for AFIP web services.
// Cert + private key are passed as base64 single-line so they survive
// copy-paste into Vercel and `.env.local` without losing line breaks.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing env var ${name}. Add it to .env.local or your hosting provider.`,
    );
  }
  return value;
}

function decodeBase64Pem(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf-8");
}

export type AfipEnv = "homo" | "prod";

export function getAfipEnv(): AfipEnv {
  const value = process.env.AFIP_ENV ?? "homo";
  if (value !== "homo" && value !== "prod") {
    throw new Error(`Invalid AFIP_ENV "${value}", expected "homo" or "prod".`);
  }
  return value;
}

export function getAfipCert(): string {
  return decodeBase64Pem(requireEnv("AFIP_CERT"));
}

export function getAfipKey(): string {
  return decodeBase64Pem(requireEnv("AFIP_KEY"));
}

export function getAfipCuit(): string {
  return requireEnv("AFIP_CUIT").replace(/[-\s]/g, "");
}

export function getWsaaUrl(): string {
  return getAfipEnv() === "prod"
    ? "https://wsaa.afip.gov.ar/ws/services/LoginCms"
    : "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";
}

export function getPadronA4Wsdl(): string {
  return getAfipEnv() === "prod"
    ? "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA4?WSDL"
    : "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA4?WSDL";
}
