import { logger } from "@/lib/logger";

type Context = Record<string, unknown>;

// Single boundary for "something went wrong, send it somewhere durable".
// When SENTRY_DSN is set we forward to Sentry; otherwise we just log. The
// Sentry import is lazy so dev/test runs that don't set the DSN never load
// the SDK (and never compile its instrumentation).

const sentryEnabled = Boolean(
  process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
);

let sentryModule: typeof import("@sentry/nextjs") | null = null;
async function getSentry() {
  if (!sentryEnabled) return null;
  if (sentryModule) return sentryModule;
  sentryModule = await import("@sentry/nextjs");
  return sentryModule;
}

/**
 * `context.op` is the event's static slug: the log line and the Sentry title
 * use it, never the error's message (a Postgres message can carry row values).
 * A Supabase error arrives as a plain `{ message, code, details }` object; its
 * `code` is kept and `details` dropped.
 */
export function captureException(
  error: unknown,
  context: { op: string } & Context,
) {
  const code = errorCode(error);
  const err = error instanceof Error ? error : new Error(context.op);
  const fields = { ...context, ...(code ? { code } : {}) };
  logger.error(context.op, { ...fields, error: err });
  if (!sentryEnabled) return;
  void getSentry().then((Sentry) => {
    if (!Sentry) return;
    Sentry.captureException(err, {
      extra: fields,
      tags: { op: context.op, ...(code ? { code } : {}) },
      fingerprint: [context.op, code ?? "no-code"],
    });
  });
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

export function captureMessage(
  message: string,
  level: "info" | "warn" | "error" = "info",
  context?: Context,
) {
  logger[level](message, context);
  if (!sentryEnabled) return;
  void getSentry().then((Sentry) => {
    if (!Sentry) return;
    Sentry.captureMessage(message, {
      level:
        level === "error" ? "error" : level === "warn" ? "warning" : "info",
      extra: context,
    });
  });
}

const capturedOnce = new Set<string>();

/** captureMessage, but once per server instance per slug. */
export function captureMessageOnce(
  message: string,
  level: "info" | "warn" | "error",
  context?: Context,
) {
  if (capturedOnce.has(message)) return;
  capturedOnce.add(message);
  captureMessage(message, level, context);
}

export function resetCaptureOnceForTests() {
  capturedOnce.clear();
}
