import "server-only";

import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";

/**
 * The 500 of a PDF route: the error goes to the log, the client gets a fixed
 * message. A renderer's error can wrap a PostgREST message (table, column or
 * constraint names), which is not for the viewer.
 */
export function pdfFailureResponse(
  event: string,
  error: unknown,
  context: Record<string, unknown> = {},
): NextResponse {
  logger.error(event, { ...context, error });
  return NextResponse.json({ error: "Error generando PDF." }, { status: 500 });
}
