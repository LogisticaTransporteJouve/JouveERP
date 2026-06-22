"use server";

import { getAfipCuit } from "@/lib/afip/env";
import { AfipError } from "@/lib/afip/errors";
import {
  runAfipDiagnostics,
  type AfipDiagnostics,
} from "@/lib/afip/diagnostics";
import { getSalesPoints, type SalesPoint } from "@/lib/afip/wsfev1";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import type { Database } from "@/lib/db/database.types";

import { ConfigurePosSchema, type ConfigurePosInput } from "../schema";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

type PuntoDeVentaRow =
  Database["public"]["Tables"]["sales_points"]["Row"];

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
  if (!userCan(ctx.roles, "afip:admin")) {
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
    supabase.from("sales_points").select("*").order("numero"),
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
    .select("numero");
  if (existing.error) {
    return { ok: false, error: existing.error.message };
  }
  const existingSet = new Set(
    (existing.data ?? []).map((row) => row.numero),
  );

  const now = new Date().toISOString();
  const upsertRows = raw.map((point) => ({
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
    .upsert(upsertRows, { onConflict: "numero", ignoreDuplicates: false })
    .select("*")
    .order("numero");
  if (upsertRes.error) {
    return { ok: false, error: upsertRes.error.message };
  }

  return {
    ok: true,
    data: {
      inserted,
      updated,
      total: raw.length,
      raw,
      salesPoints: (upsertRes.data ?? []).map(rowToSalesPoint),
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
  const update = await supabase
    .from("sales_points")
    .update({ channel_id, nickname, is_enabled })
    .eq("numero", numero)
    .select("*")
    .maybeSingle();
  if (update.error) {
    return { ok: false, error: update.error.message };
  }
  if (!update.data) {
    return {
      ok: false,
      error: `El POS ${numero} no existe en DB. Sincronizá con AFIP primero.`,
    };
  }
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
