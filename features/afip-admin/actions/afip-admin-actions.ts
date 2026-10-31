"use server";

import { getAfipCuit } from "@/lib/afip/env";
import { AfipError } from "@/lib/afip/errors";
import {
  runAfipDiagnostics,
  type AfipDiagnostics,
} from "@/lib/afip/diagnostics";
import { getSalesPoints, type SalesPoint } from "@/lib/afip/wsfev1";
import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import type { Database } from "@/lib/db/database.types";

import { ConfigurePosSchema, type ConfigurePosInput } from "../schema";

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string; code?: string };

type PuntoDeVentaRow = Database["public"]["Tables"]["sales_points"]["Row"];

export interface SalesPointRow {
  numero: number;
  channel_id: string | null;
  nickname: string | null;
  is_enabled: boolean;
  last_known_emission_type: string | null;
  last_known_blocked: boolean;
  last_synced_at: string | null;
}

export interface AfipAdminPayload {
  cuit: string;
  diagnostics: AfipDiagnostics;
  salesPoints: SalesPointRow[];
}

function rowToSalesPoint(row: PuntoDeVentaRow): SalesPointRow {
  return {
    numero: row.numero,
    channel_id: row.channel_id,
    nickname: row.nickname,
    is_enabled: row.is_enabled,
    last_known_emission_type: row.last_known_emission_type,
    last_known_blocked: row.last_known_blocked,
    last_synced_at: row.last_synced_at,
  };
}

async function requireAfipAdmin() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "afip:admin")) {
    return null;
  }
  return ctx;
}

export async function loadAfipAdminAction(): Promise<
  ActionResult<AfipAdminPayload>
> {
  const ctx = await requireAfipAdmin();
  if (!ctx) {
    return { ok: false, error: "No tenés permiso para administrar AFIP." };
  }

  const supabase = getServiceClient();
  const [diagnosticsRes, dbRes] = await Promise.all([
    runAfipDiagnostics().catch((err): AfipDiagnostics => {
      logger.warn("afip.diagnostics_threw", {
        userId: ctx.userId,
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }),
    supabase
      .from("sales_points")
      .select(
        "numero, channel_id, nickname, is_enabled, last_known_emission_type, last_known_blocked, last_synced_at, created_at, updated_at",
      )
      .order("numero"),
  ]);

  if (dbRes.error) {
    return { ok: false, error: dbRes.error.message };
  }

  return {
    ok: true,
    data: {
      cuit: getAfipCuit(),
      diagnostics: diagnosticsRes,
      salesPoints: (dbRes.data ?? []).map(rowToSalesPoint),
    },
  };
}

export interface SyncResult {
  inserted: number;
  updated: number;
  total: number;
  raw: SalesPoint[];
  salesPoints: SalesPointRow[];
}

export async function syncAfipPosAction(): Promise<ActionResult<SyncResult>> {
  const ctx = await requireAfipAdmin();
  if (!ctx) {
    return { ok: false, error: "No tenés permiso para administrar AFIP." };
  }

  let raw: SalesPoint[];
  try {
    raw = await getSalesPoints();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error consultando WSFEv1.";
    const code = err instanceof AfipError ? err.code : undefined;
    return { ok: false, error: message, code };
  }

  const supabase = getServiceClient();
  const existing = await supabase
    .from("sales_points")
    .select("numero, channel:invoicing_channels(is_fiscal)");
  if (existing.error) {
    return { ok: false, error: existing.error.message };
  }
  const existingSet = new Set((existing.data ?? []).map((row) => row.numero));
  // A POS on an internal channel is not an AFIP point of sale: syncing it would
  // mark it as synced with AFIP.
  const internalSet = new Set(
    (existing.data ?? [])
      .filter((row) => row.channel && !row.channel.is_fiscal)
      .map((row) => row.numero),
  );
  const conflicts = raw.filter((point) => internalSet.has(point.number));
  if (conflicts.length > 0) {
    logger.warn("afip.pos_sync.internal_conflict", { count: conflicts.length });
  }

  const now = new Date().toISOString();
  const upsertRows = raw
    .filter((point) => !internalSet.has(point.number))
    .map((point) => ({
      numero: point.number,
      last_known_emission_type: point.emissionType,
      last_known_blocked: point.blocked,
      last_synced_at: now,
    }));

  let inserted = 0;
  let updated = 0;
  for (const row of upsertRows) {
    if (existingSet.has(row.numero)) updated += 1;
    else inserted += 1;
  }

  const upsertRes = await supabase
    .from("sales_points")
    .upsert(upsertRows, { onConflict: "numero", ignoreDuplicates: false });
  if (upsertRes.error) {
    return { ok: false, error: upsertRes.error.message };
  }
  const listRes = await supabase
    .from("sales_points")
    .select(
      "numero, channel_id, nickname, is_enabled, last_known_emission_type, last_known_blocked, last_synced_at, created_at, updated_at",
    )
    .order("numero");
  if (listRes.error) {
    return { ok: false, error: listRes.error.message };
  }

  await logAudit("afip.pos_synced", ctx.userId, { total: raw.length });

  return {
    ok: true,
    data: {
      inserted,
      updated,
      total: raw.length,
      raw,
      salesPoints: (listRes.data ?? []).map(rowToSalesPoint),
    },
  };
}

export async function configurePosAction(
  input: ConfigurePosInput,
): Promise<ActionResult<SalesPointRow>> {
  const ctx = await requireAfipAdmin();
  if (!ctx) {
    return { ok: false, error: "No tenés permiso para administrar AFIP." };
  }

  const parsed = ConfigurePosSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { numero, channel_id, nickname, is_enabled } = parsed.data;

  if (is_enabled && !channel_id) {
    return {
      ok: false,
      error: "Para habilitar el POS hay que asignarle un canal.",
    };
  }

  const supabase = getServiceClient();
  const current = await supabase
    .from("sales_points")
    .select("channel_id")
    .eq("numero", numero)
    .maybeSingle();
  if (current.error) {
    return { ok: false, error: current.error.message };
  }
  if (!current.data) {
    return {
      ok: false,
      error: `El POS ${numero} no existe en DB. Sincronizá con AFIP primero.`,
    };
  }

  // A POS of an inactive channel can still be disabled or renamed; it cannot
  // be enabled or moved there.
  if (channel_id && (is_enabled || channel_id !== current.data.channel_id)) {
    const channel = await supabase
      .from("invoicing_channels")
      .select("is_active")
      .eq("id", channel_id)
      .maybeSingle();
    if (channel.error) {
      return { ok: false, error: channel.error.message };
    }
    if (!channel.data?.is_active) {
      return { ok: false, error: "El canal no existe o está inactivo." };
    }
  }

  // loadChannelPos numbers with the lowest enabled POS of the channel: a second
  // one would move the numbering.
  if (is_enabled && channel_id) {
    const other = await supabase
      .from("sales_points")
      .select("numero")
      .eq("channel_id", channel_id)
      .eq("is_enabled", true)
      .neq("numero", numero)
      .limit(1)
      .maybeSingle();
    if (other.error) {
      return { ok: false, error: other.error.message };
    }
    if (other.data) {
      return {
        ok: false,
        error: `El canal ya tiene habilitado el POS ${other.data.numero}. Deshabilitalo antes de habilitar otro.`,
      };
    }
  }

  const update = await supabase
    .from("sales_points")
    .update({ channel_id, nickname, is_enabled })
    .eq("numero", numero)
    .select(
      "numero, channel_id, nickname, is_enabled, last_known_emission_type, last_known_blocked, last_synced_at, created_at, updated_at",
    )
    .maybeSingle();
  if (update.error) {
    const guardError = mapDbGuardError(update.error, {
      slug: "afip.pos_configure.rejected",
      userId: ctx.userId,
      id: String(numero),
    });
    return { ok: false, error: guardError ?? update.error.message };
  }
  if (!update.data) {
    return {
      ok: false,
      error: `El POS ${numero} no existe en DB. Sincronizá con AFIP primero.`,
    };
  }
  await logAudit(
    "afip.pos_configured",
    ctx.userId,
    { numero, channel_id, is_enabled },
    String(numero),
  );
  return { ok: true, data: rowToSalesPoint(update.data) };
}

export async function listInvoicingChannelsAction(): Promise<
  ActionResult<Array<{ id: string; name: string; is_fiscal: boolean }>>
> {
  const ctx = await requireAfipAdmin();
  if (!ctx) {
    return { ok: false, error: "No tenés permiso para administrar AFIP." };
  }

  const supabase = getServiceClient();
  const res = await supabase
    .from("invoicing_channels")
    .select("id, name, is_fiscal, is_active")
    .eq("is_active", true)
    .eq("is_fiscal", true)
    .order("name");
  if (res.error) {
    return { ok: false, error: res.error.message };
  }
  return {
    ok: true,
    data: (res.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      is_fiscal: c.is_fiscal,
    })),
  };
}

// ---------------------------------------------------------------------------
// CAEA — contingencia (L.7)
// ---------------------------------------------------------------------------

export interface CaeaStatus {
  codes: Array<{
    id: string;
    periodo: number;
    orden: number;
    caea: string;
    fch_vig_desde: string;
    fch_vig_hasta: string;
    fch_tope_inf: string;
    created_at: string;
  }>;
  /** Comprobantes CAEA emitidos y todavía no informados a AFIP. */
  pendingToInform: number;
}

export async function getCaeaStatusAction(): Promise<ActionResult<CaeaStatus>> {
  const ctx = await requireAfipAdmin();
  if (!ctx) {
    return { ok: false, error: "No tenés permiso para administrar AFIP." };
  }
  const supabase = getServiceClient();
  const [codesRes, pendingRes] = await Promise.all([
    supabase
      .from("caea_codes")
      .select(
        "id, periodo, orden, caea, fch_vig_desde, fch_vig_hasta, fch_tope_inf, created_at",
      )
      .order("periodo", { ascending: false })
      .order("orden", { ascending: false })
      .limit(8),
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("emission_type", "caea")
      .is("caea_informed_at", null)
      .eq("status", "emitted"),
  ]);
  if (codesRes.error) {
    logger.error("caea.status.failed", {
      userId: ctx.userId,
      error: codesRes.error,
    });
    return { ok: false, error: "No se pudo leer el estado CAEA." };
  }
  return {
    ok: true,
    data: {
      codes: codesRes.data ?? [],
      pendingToInform: pendingRes.count ?? 0,
    },
  };
}

/**
 * Requests the current + next fortnight's CAEA on demand (same path the
 * caea-request cron uses). Fails with AFIP's message when the CUIT has no
 * CAEA contingency POS registered in ARCA's ABM (15003) or the window is
 * closed (15006).
 */
export async function requestCaeaNowAction(): Promise<
  ActionResult<{ current: string | null; next: string | null }>
> {
  const ctx = await requireAfipAdmin();
  if (!ctx) {
    return { ok: false, error: "No tenés permiso para administrar AFIP." };
  }

  const { ensureCaea } = await import("@/lib/afip/caea");
  const { nextQuincena, quincenaOf } = await import("@/lib/afip/caea-periods");
  const { todayInAR } = await import("@/lib/format");

  const current = quincenaOf(todayInAR());
  let currentCaea: string | null = null;
  let nextCaea: string | null = null;
  let firstError: string | null = null;

  try {
    currentCaea = (await ensureCaea(current)).caea;
  } catch (err) {
    firstError = err instanceof Error ? err.message : String(err);
  }
  try {
    nextCaea = (await ensureCaea(nextQuincena(current))).caea;
  } catch (err) {
    // La próxima quincena puede estar fuera de ventana (15006) — no es error
    // si la actual se obtuvo.
    logger.info("caea.request_now.next_unavailable", {
      userId: ctx.userId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  if (!currentCaea && !nextCaea) {
    return { ok: false, error: firstError ?? "No se pudo obtener el CAEA." };
  }

  await logAudit("caea.requested", ctx.userId, {
    current: currentCaea,
    next: nextCaea,
  });
  return { ok: true, data: { current: currentCaea, next: nextCaea } };
}

/** Queues the ARCA → ERP import of issued vouchers (same job as the hourly
 *  cron); the vouchers land in Comprobantes as the job advances. */
export async function requestArcaSyncAction(): Promise<ActionResult<null>> {
  const ctx = await requireAfipAdmin();
  if (!ctx) {
    return { ok: false, error: "No tenés permiso para administrar AFIP." };
  }

  const { inngest } = await import("@/lib/inngest/client");
  const { ARCA_ISSUED_SYNC_REQUESTED } = await import("@/lib/inngest/events");
  try {
    await inngest.send({
      name: ARCA_ISSUED_SYNC_REQUESTED,
      data: { requested_by: ctx.userId },
    });
  } catch (err) {
    logger.error("arca_sync.enqueue_failed", {
      userId: ctx.userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: "No se pudo iniciar la importación. Probá de nuevo en un rato.",
    };
  }

  await logAudit("afip.issued_sync_requested", ctx.userId, {});
  return { ok: true, data: null };
}
