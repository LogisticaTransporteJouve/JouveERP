"use server";

import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCanAll } from "@/lib/auth/permissions";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import {
  closeStaleBulkRuns,
  failBulkRun,
  readLatestBulkRun,
} from "@/lib/purchases/arca-bulk-accept";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import {
  ARCA_BULK_ACCEPT_PERMISSIONS,
  BULK_OPENING_DATE,
  type BulkRun,
} from "../lib/arca-bulk-accept";

const DENIED =
  "Solo el owner puede aceptar todos los pendientes: crea proveedores, carga compras y fija saldos de apertura.";
const FAILED = "No se pudo pedir la carga. Probá de nuevo en un rato.";

/** The latest «Aceptar todos los pendientes» run, or null when there was none. */
export async function getArcaBulkAcceptStatusAction(): Promise<
  ActionResult<BulkRun | null>
> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, ARCA_BULK_ACCEPT_PERMISSIONS)) {
    return { ok: false, error: DENIED };
  }
  try {
    return { ok: true, data: await readLatestBulkRun(getServiceClient()) };
  } catch (err) {
    logger.error("arca_bulk_accept.status_failed", {
      userId: ctx.userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "No se pudo leer la última carga." };
  }
}

const RequestSchema = z.object({ confirm: z.literal(true) });

/** Queues a run that creates the missing suppliers, loads every pending
 *  voucher as a purchase and settles up to BULK_OPENING_DATE. */
export async function requestArcaBulkAcceptAction(
  input: unknown,
): Promise<ActionResult<{ runId: string }>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, ARCA_BULK_ACCEPT_PERMISSIONS)) {
    return { ok: false, error: DENIED };
  }
  if (!RequestSchema.safeParse(input).success) {
    return { ok: false, error: "Confirmá la carga." };
  }

  const service = getServiceClient();
  try {
    await closeStaleBulkRuns(service);
  } catch (err) {
    logger.error("arca_bulk_accept.stale_close_failed", {
      userId: ctx.userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: FAILED };
  }
  // Inserted before the send: the tray follows the run at once, and the open
  // row refuses a second request (one open run at a time).
  const { data: run, error } = await service
    .from("arca_bulk_accept_runs")
    .insert({ requested_by: ctx.userId })
    .select("id")
    .single();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Ya hay una carga de todos los pendientes en curso.",
      };
    }
    logger.error("arca_bulk_accept.insert_failed", {
      userId: ctx.userId,
      code: error.code,
    });
    return { ok: false, error: FAILED };
  }

  const { inngest } = await import("@/lib/inngest/client");
  const { ARCA_BULK_ACCEPT_REQUESTED } = await import("@/lib/inngest/events");
  try {
    await inngest.send({
      id: `arca-bulk-accept-${run.id}`,
      name: ARCA_BULK_ACCEPT_REQUESTED,
      data: { run_id: run.id, requested_by: ctx.userId },
    });
  } catch (err) {
    logger.error("arca_bulk_accept.enqueue_failed", {
      userId: ctx.userId,
      err: err instanceof Error ? err.message : String(err),
    });
    await failBulkRun(service, run.id, "No se pudo encolar la carga.");
    return { ok: false, error: FAILED };
  }
  await logAudit(
    "purchase_invoice.arca_bulk_accept_requested",
    ctx.userId,
    { runId: run.id, openingDate: BULK_OPENING_DATE },
    run.id,
  );
  return { ok: true, data: { runId: run.id } };
}
