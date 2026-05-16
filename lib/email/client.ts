import "server-only";

import { Resend } from "resend";

// Singleton Resend client. Devuelve null si RESEND_API_KEY no está seteada
// (dev sin email configurado) — el caller debe distinguir entre "feature
// deshabilitada" y "error de envío".
let cached: Resend | null | undefined;

export function getResendClient(): Resend | null {
  if (cached !== undefined) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    cached = null;
    return null;
  }
  cached = new Resend(key);
  return cached;
}

export function getEmailFrom(): string {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM no está configurado.");
  return from;
}

export function getEmailReplyTo(): string | undefined {
  return process.env.EMAIL_REPLY_TO || undefined;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
