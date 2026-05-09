// Next.js instrumentation hook. Initializes Sentry only when SENTRY_DSN is
// set — local dev and CI without a DSN run as if Sentry weren't installed.
// The actual init lives in the runtime-specific `sentry.*.config.ts` files
// to keep the tree-shake boundary clean.

export async function register() {
  if (!process.env.SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export async function onRequestError(
  ...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>
) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
}
