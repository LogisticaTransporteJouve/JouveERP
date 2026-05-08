import { logger } from "@/lib/logger";

type Context = Record<string, unknown>;

export function captureException(error: unknown, context?: Context) {
  const err =
    error instanceof Error ? error : new Error(String(error ?? "unknown error"));
  logger.error(err.message, { ...context, error: err });
}

export function captureMessage(
  message: string,
  level: "info" | "warn" | "error" = "info",
  context?: Context,
) {
  logger[level](message, context);
}
