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

export function captureException(error: unknown, context?: Context) {
  const err =
    error instanceof Error ? error : new Error(String(error ?? "unknown error"));
  logger.error(err.message, { ...context, error: err });
  if (!sentryEnabled) return;
  void getSentry().then((Sentry) => {
    if (!Sentry) return;
    Sentry.captureException(err, context ? { extra: context } : undefined);
  });
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
      level: level === "error" ? "error" : level === "warn" ? "warning" : "info",
      extra: context,
    });
  });
}
