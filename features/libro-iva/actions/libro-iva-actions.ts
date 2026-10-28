"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { PeriodSchema } from "@/lib/validation/common";

import { buildComprasTxt, buildVentasTxt, type CitiExport } from "../lib/citi";
import {
  fetchLibroIvaComprasRows,
  fetchLibroIvaVentasRows,
} from "../lib/fetch-books";
import {
  groupByInvoice,
  groupComprasByInvoice,
  type LibroIvaComprasRow,
  type LibroIvaVentasRow,
} from "../schema";

const LibroIvaInput = z.object({
  period: PeriodSchema,
  channelId: z.string().nullable().optional(),
});

export async function listLibroIvaVentasAction(input: {
  period: string;
  channelId?: string | null;
}): Promise<ActionResult<LibroIvaVentasRow[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso para ver el libro IVA." };
  }
  const parsed = LibroIvaInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Input inválido.",
    };
  }
  input = parsed.data;

  const supabase = await createClient();
  const { data, error } = await fetchLibroIvaVentasRows(
    supabase,
    input.period,
    input.channelId ?? null,
  );

  if (error) {
    logger.error("libro_iva_ventas.failed", {
      userId: ctx.userId,
      period: input.period,
      error,
    });
    return { ok: false, error: "No se pudo leer el libro IVA Ventas." };
  }

  return { ok: true, data };
}

export async function listLibroIvaComprasAction(input: {
  period: string;
  channelId?: string | null;
}): Promise<ActionResult<LibroIvaComprasRow[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso para ver el libro IVA." };
  }
  const parsed = LibroIvaInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Input inválido.",
    };
  }
  input = parsed.data;

  const supabase = await createClient();
  const { data, error } = await fetchLibroIvaComprasRows(
    supabase,
    input.period,
    input.channelId ?? null,
  );

  if (error) {
    logger.error("libro_iva_compras.failed", {
      userId: ctx.userId,
      period: input.period,
      error,
    });
    return { ok: false, error: "No se pudo leer el libro IVA Compras." };
  }

  return { ok: true, data };
}

const ExportTxtInput = z.object({
  period: PeriodSchema,
  book: z.enum(["ventas", "compras"]),
});

/**
 * Positional TXT files for ARCA's Libro IVA Digital / Portal IVA import
 * (RG 3685 record design): comprobantes + alícuotas for the period, built from
 * the same RPCs the on-screen books use (fiscal channels only), with amounts in
 * each document's currency plus its moneda and cotizacion. Returns the file
 * contents — the client downloads them; nothing is stored.
 */
export async function exportLibroIvaTxtAction(input: {
  period: string;
  book: "ventas" | "compras";
}): Promise<ActionResult<CitiExport>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso para exportar el libro IVA." };
  }
  const parsed = ExportTxtInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Input inválido.",
    };
  }
  const { period, book } = parsed.data;

  const supabase = await createClient();

  if (book === "ventas") {
    const { data, error } = await fetchLibroIvaVentasRows(
      supabase,
      period,
      null,
    );
    if (error) {
      logger.error("libro_iva.export.ventas_failed", {
        userId: ctx.userId,
        period,
        error,
      });
      return { ok: false, error: "No se pudo leer el libro IVA Ventas." };
    }
    const grouped = groupByInvoice(data);
    const result = buildVentasTxt(grouped, period);
    await logAudit("libro_iva.txt_exported", ctx.userId, {
      book,
      period,
      documents: result.documents,
      warnings: result.warnings.length,
    });
    return { ok: true, data: result };
  }

  const { data, error } = await fetchLibroIvaComprasRows(
    supabase,
    period,
    null,
  );
  if (error) {
    logger.error("libro_iva.export.compras_failed", {
      userId: ctx.userId,
      period,
      error,
    });
    return { ok: false, error: "No se pudo leer el libro IVA Compras." };
  }
  const grouped = groupComprasByInvoice(data);
  const result = buildComprasTxt(grouped, period);
  await logAudit("libro_iva.txt_exported", ctx.userId, {
    book,
    period,
    documents: result.documents,
    warnings: result.warnings.length,
  });
  return { ok: true, data: result };
}
