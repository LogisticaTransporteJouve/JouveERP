"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { z } from "zod";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { PeriodSchema } from "@/lib/validation/common";

import {
  buildComprasTxt,
  buildVentasTxt,
  type CitiExport,
  type ComprasDocExtra,
  type VentasDocExtra,
} from "../lib/citi";
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
  if (!userCan(ctx.roles, "accounting:read")) {
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
  const { data, error } = await supabase.rpc("libro_iva_ventas", {
    p_period: input.period,
    p_channel_id: input.channelId ?? undefined,
  });

  if (error) {
    logger.error("libro_iva_ventas.failed", {
      userId: ctx.userId,
      period: input.period,
      error,
    });
    return { ok: false, error: "No se pudo leer el libro IVA Ventas." };
  }

  return { ok: true, data: (data ?? []) as LibroIvaVentasRow[] };
}

export async function listLibroIvaComprasAction(input: {
  period: string;
  channelId?: string | null;
}): Promise<ActionResult<LibroIvaComprasRow[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
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
  const { data, error } = await supabase.rpc("libro_iva_compras", {
    p_period: input.period,
    p_channel_id: input.channelId ?? undefined,
  });

  if (error) {
    logger.error("libro_iva_compras.failed", {
      userId: ctx.userId,
      period: input.period,
      error,
    });
    return { ok: false, error: "No se pudo leer el libro IVA Compras." };
  }

  return { ok: true, data: (data ?? []) as LibroIvaComprasRow[] };
}

const ExportTxtInput = z.object({
  period: PeriodSchema,
  book: z.enum(["ventas", "compras"]),
});

/**
 * Positional TXT files for ARCA's Libro IVA Digital / Portal IVA import
 * (RG 3685 record design): comprobantes + alícuotas for the period, built from
 * the same RPCs the on-screen books use (fiscal channels only). Returns the
 * file contents — the client downloads them; nothing is stored.
 */
export async function exportLibroIvaTxtAction(input: {
  period: string;
  book: "ventas" | "compras";
}): Promise<ActionResult<CitiExport>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
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
    const { data, error } = await supabase.rpc("libro_iva_ventas", {
      p_period: period,
    });
    if (error) {
      logger.error("libro_iva.export.ventas_failed", {
        userId: ctx.userId,
        period,
        error,
      });
      return { ok: false, error: "No se pudo leer el libro IVA Ventas." };
    }
    const grouped = groupByInvoice((data ?? []) as LibroIvaVentasRow[]);

    const extras = new Map<string, VentasDocExtra>();
    if (grouped.length > 0) {
      const { data: monedas } = await supabase
        .from("invoices")
        .select("id, moneda, cotizacion")
        .in("id", grouped.map((g) => g.invoice_id));
      for (const m of monedas ?? []) {
        extras.set(m.id, { moneda: m.moneda, cotizacion: Number(m.cotizacion) });
      }
    }

    const result = buildVentasTxt(grouped, extras, period);
    await logAudit("libro_iva.txt_exported", ctx.userId, {
      book,
      period,
      documents: result.documents,
      warnings: result.warnings.length,
    });
    return { ok: true, data: result };
  }

  const { data, error } = await supabase.rpc("libro_iva_compras", {
    p_period: period,
  });
  if (error) {
    logger.error("libro_iva.export.compras_failed", {
      userId: ctx.userId,
      period,
      error,
    });
    return { ok: false, error: "No se pudo leer el libro IVA Compras." };
  }
  const grouped = groupComprasByInvoice((data ?? []) as LibroIvaComprasRow[]);

  const extras = new Map<string, ComprasDocExtra>();
  if (grouped.length > 0) {
    const { data: monedas } = await supabase
      .from("purchase_invoices")
      .select("id, moneda, cotizacion")
      .in("id", grouped.map((g) => g.purchase_invoice_id));
    for (const m of monedas ?? []) {
      extras.set(m.id, { moneda: m.moneda, cotizacion: Number(m.cotizacion) });
    }
  }

  const result = buildComprasTxt(grouped, extras, period);
  await logAudit("libro_iva.txt_exported", ctx.userId, {
    book,
    period,
    documents: result.documents,
    warnings: result.warnings.length,
  });
  return { ok: true, data: result };
}
