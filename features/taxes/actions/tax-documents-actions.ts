"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { ivaIsComputable } from "@/lib/afip/codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";
import { round2 } from "@/lib/format";
import { isUsdCurrency } from "@/lib/fx";
import { PeriodSchema } from "@/lib/validation/common";

import {
  listLibroIvaComprasAction,
  listLibroIvaVentasAction,
} from "@/features/libro-iva/actions/libro-iva-actions";
import {
  computeComprasTotals,
  computeTotals,
  groupByInvoice,
  groupComprasByInvoice,
} from "@/features/libro-iva/schema";
import type { ReceiptStatus } from "@/features/receipts/schema";

import {
  addOneMonth,
  computeIvaPosition,
  CopyTaxPeriodSchema,
  isTaxKind,
  isTaxPaymentOrigin,
  isTaxStatus,
  PayTaxDocumentSchema,
  previousIvaCreditBalance,
  previousPeriod,
  sumIva,
  TaxDocumentCreateSchema,
  TaxDocumentUpdateSchema,
  TaxListSchema,
  TaxStatusChangeSchema,
  type IvaPositionEstimate,
  type TaxDocument,
} from "../schema";

const SELECT_COLUMNS =
  "id, kind, title, jurisdiction, period, due_date, amount, amount_is_estimate, status, account_id, payment_transaction_id, payment_origin, paid_date, paid_amount, credit_balance, notes, account:chart_of_accounts!tax_documents_account_id_fkey ( code, name ), payment:transactions!tax_documents_payment_transaction_id_fkey ( account:accounts ( name ) )";

type TaxRow = {
  id: string;
  kind: string;
  title: string | null;
  jurisdiction: string | null;
  period: string;
  due_date: string;
  amount: number | null;
  amount_is_estimate: boolean;
  status: string;
  account_id: string | null;
  payment_transaction_id: string | null;
  payment_origin: string | null;
  paid_date: string | null;
  paid_amount: number | null;
  credit_balance: number | null;
  notes: string | null;
  account: { code: string; name: string } | null;
  payment: { account: { name: string } | null } | null;
};

function narrowTaxDocument(row: TaxRow): TaxDocument | null {
  const { kind, status, payment_origin: origin } = row;
  if (
    !isTaxKind(kind) ||
    !isTaxStatus(status) ||
    (origin !== null && !isTaxPaymentOrigin(origin))
  ) {
    logger.error("tax_documents.unknown_value", {
      id: row.id,
      kind,
      status,
      origin,
    });
    return null;
  }
  return {
    id: row.id,
    kind,
    title: row.title,
    jurisdiction: row.jurisdiction,
    period: row.period,
    due_date: row.due_date,
    amount: row.amount === null ? null : Number(row.amount),
    amount_is_estimate: row.amount_is_estimate,
    status,
    account_id: row.account_id,
    account_name: row.account
      ? `${row.account.code} ${row.account.name}`
      : null,
    payment_transaction_id: row.payment_transaction_id,
    payment_origin: origin,
    paid_date: row.paid_date,
    paid_amount: row.paid_amount === null ? null : Number(row.paid_amount),
    paid_from: row.payment?.account?.name ?? null,
    credit_balance:
      row.credit_balance === null ? null : Number(row.credit_balance),
    notes: row.notes,
  };
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

const DUPLICATE_MESSAGE =
  "Ya hay un impuesto de ese tipo y período (con la misma jurisdicción y nombre). Editá el existente o anulalo.";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The year's documents plus every still-open one from earlier years, by
 *  due date. */
export async function listTaxDocumentsAction(input: {
  year: number;
}): Promise<ActionResult<TaxDocument[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "taxes:read")) {
    return { ok: false, error: "No tenés permiso para ver impuestos." };
  }
  const parsed = TaxListSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { year } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("tax_documents")
      .select(SELECT_COLUMNS)
      .or(
        `and(period.gte.${year}-01,period.lte.${year}-12),and(period.lt.${year}-01,status.in.(pendiente,liquidado))`,
      )
      .order("due_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) {
    logger.error("tax_documents.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron leer los impuestos." };
  }
  const docs = (data ?? [])
    .map((row) => narrowTaxDocument(row))
    .filter((d): d is TaxDocument => d !== null);
  return { ok: true, data: docs };
}

export type TaxAccountOption = {
  id: string;
  label: string;
  system_role: string | null;
};

/** The chart-of-accounts leaves a tax payment may debit (the same rule as
 *  guard_tax_document): active, activo / pasivo / gasto, not cash, bank,
 *  clients or suppliers. */
export async function listTaxAccountOptionsAction(): Promise<
  ActionResult<TaxAccountOption[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "taxes:write")) {
    return { ok: false, error: "No tenés permiso para cargar impuestos." };
  }
  const supabase = await createClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("chart_of_accounts")
      .select("id, code, name, parent_id, account_type, system_role, is_active")
      .order("code", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) {
    logger.error("tax_documents.accounts.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo leer el plan de cuentas." };
  }
  const rows = data ?? [];
  const parents = new Set(rows.map((r) => r.parent_id).filter(Boolean));
  const excluded = new Set([
    "caja",
    "banco",
    "cheques_cartera",
    "clientes",
    "proveedores",
  ]);
  const options = rows
    .filter(
      (r) =>
        r.is_active &&
        !parents.has(r.id) &&
        ["activo", "pasivo", "resultado_negativo"].includes(r.account_type) &&
        !(r.system_role && excluded.has(r.system_role)),
    )
    .map((r) => ({
      id: r.id,
      label: `${r.code} ${r.name}`,
      system_role: r.system_role,
    }));
  return { ok: true, data: options };
}

// Typed against the receipts' status set, so a value the column's CHECK
// never admits fails the typecheck instead of silently matching no row.
const ISSUED_RECEIPT: ReceiptStatus = "issued";

/**
 * IVA position of a period estimated from the libro IVA (fiscal channels):
 * débito of the sales book − crédito of the purchases book − IVA retentions
 * and perceptions suffered on the period's receipts − the saldo a favor
 * técnico the previous period's IVA document carries − the IVA perceptions
 * of the period's purchases. The purchases' other taxes (IIBB, Ganancias,
 * municipales, internos) are returned apart, not subtracted.
 */
export async function getIvaPositionEstimateAction(input: {
  period: string;
}): Promise<ActionResult<IvaPositionEstimate>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "taxes:write")) {
    return { ok: false, error: "No tenés permiso para cargar impuestos." };
  }
  if (!userCan(ctx.access, "accounting:read")) {
    return {
      ok: false,
      error: "Para estimar el IVA necesitás ver el libro IVA (Contabilidad).",
    };
  }
  const parsed = PeriodSchema.safeParse(input.period);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const period = parsed.data;

  // The books' own read actions: the same rows, gate and fiscal filter the
  // libro IVA screens use.
  const [ventas, compras] = await Promise.all([
    listLibroIvaVentasAction({ period, channelId: null }),
    listLibroIvaComprasAction({ period, channelId: null }),
  ]);
  if (!ventas.ok) return ventas;
  if (!compras.ok) return compras;

  const supabase = await createClient();

  const [y, m] = period.split("-").map(Number);
  const from = `${period}-01`;
  const to = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  const { data: retentions, error: retError } = await paginateRange(
    (rFrom, rTo) =>
      supabase
        .from("receipt_retentions")
        .select(
          "id, amount, receipt:receipts!inner ( status, currency, cotizacion, channel:invoicing_channels!inner ( is_fiscal ) )",
        )
        .eq("tax_type", "iva")
        .gte("certificate_date", from)
        .lte("certificate_date", to)
        .eq("receipt.status", ISSUED_RECEIPT)
        .eq("receipt.channel.is_fiscal", true)
        .order("id", { ascending: true })
        .range(rFrom, rTo),
  );
  if (retError) {
    logger.error("tax_documents.iva_estimate.retentions_failed", {
      userId: ctx.userId,
      period,
      error: retError,
    });
    return {
      ok: false,
      error: "No se pudieron leer las retenciones de IVA del período.",
    };
  }

  // In pesos at the receipt's own rate, the way the receipt's journal entry
  // posts it. A legacy USD receipt with no stored rate has no peso value here:
  // refusing beats adding dollars as pesos.
  const retentionsArs: number[] = [];
  for (const r of retentions ?? []) {
    const amount = Number(r.amount);
    if (!isUsdCurrency(r.receipt.currency)) {
      retentionsArs.push(amount);
      continue;
    }
    const rate = Number(r.receipt.cotizacion ?? 0);
    if (!(rate > 0)) {
      return {
        ok: false,
        error:
          "Hay una retención de IVA en un recibo en dólares sin cotización: cargala en el recibo para estimar el IVA.",
      };
    }
    retentionsArs.push(round2(amount * rate));
  }

  const { data: previousDocs, error: prevError } = await supabase
    .from("tax_documents")
    .select("id, status, credit_balance, updated_at")
    .eq("kind", "iva")
    .eq("period", previousPeriod(period))
    .order("updated_at", { ascending: false });
  if (prevError) {
    logger.error("tax_documents.iva_estimate.previous_failed", {
      userId: ctx.userId,
      period,
      error: prevError,
    });
    return {
      ok: false,
      error: "No se pudo leer el IVA del mes anterior.",
    };
  }

  const ventasGrouped = groupByInvoice(ventas.data);
  const comprasGrouped = groupComprasByInvoice(compras.data);
  const comprasTotals = computeComprasTotals(comprasGrouped);
  const estimate = computeIvaPosition({
    period,
    debito: sumIva(computeTotals(ventasGrouped).per_rate),
    // Only a letter A purchase gives IVA crédito, as the CITI TXT declares.
    credito: sumIva(
      computeComprasTotals(
        comprasGrouped.filter((r) => ivaIsComputable(r.letter)),
      ).per_rate,
    ),
    retenciones: retentionsArs.reduce((acc, amount) => acc + amount, 0),
    saldoAnterior: previousIvaCreditBalance(
      (previousDocs ?? []).map((d) => ({
        status: d.status,
        credit_balance:
          d.credit_balance === null ? null : Number(d.credit_balance),
        updated_at: d.updated_at,
      })),
    ),
    percepcionesCompras: comprasTotals.breakdown.perc_iva,
    tributosCompras: comprasTotals.imp_trib - comprasTotals.breakdown.perc_iva,
    ventas: ventasGrouped.length,
    compras: comprasGrouped.length,
  });
  return { ok: true, data: estimate };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createTaxDocumentAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "taxes:write")) {
    return { ok: false, error: "No tenés permiso para cargar impuestos." };
  }
  const parsed = TaxDocumentCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tax_documents")
    .insert({
      kind: d.kind,
      title: d.title,
      jurisdiction: d.jurisdiction,
      period: d.period,
      due_date: d.due_date,
      amount: d.amount,
      amount_is_estimate: d.amount_is_estimate,
      account_id: d.account_id,
      credit_balance: d.credit_balance,
      notes: d.notes,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: DUPLICATE_MESSAGE };
    }
    const guardError = mapDbGuardError(error, {
      slug: "tax_documents.create.rejected",
      userId: ctx.userId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("tax_documents.create.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cargar el impuesto." };
  }
  await logAudit(
    "tax_document.created",
    ctx.userId,
    { kind: d.kind, period: d.period, estimate: d.amount_is_estimate },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

export async function updateTaxDocumentAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "taxes:write")) {
    return { ok: false, error: "No tenés permiso para editar impuestos." };
  }
  const parsed = TaxDocumentUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, ...d } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tax_documents")
    .update({
      kind: d.kind,
      title: d.title,
      jurisdiction: d.jurisdiction,
      period: d.period,
      due_date: d.due_date,
      amount: d.amount,
      amount_is_estimate: d.amount_is_estimate,
      account_id: d.account_id,
      credit_balance: d.credit_balance,
      notes: d.notes,
    })
    .eq("id", id)
    .select("id");
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: DUPLICATE_MESSAGE };
    }
    const guardError = mapDbGuardError(error, {
      slug: "tax_documents.update.rejected",
      userId: ctx.userId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("tax_documents.update.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo guardar el impuesto." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "No encontramos el impuesto." };
  }
  await logAudit(
    "tax_document.updated",
    ctx.userId,
    { kind: d.kind, period: d.period, estimate: d.amount_is_estimate },
    id,
  );
  return { ok: true, data: undefined };
}

/** pendiente ↔ liquidado, or anulado. */
export async function setTaxDocumentStatusAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "taxes:write")) {
    return { ok: false, error: "No tenés permiso para editar impuestos." };
  }
  const parsed = TaxStatusChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, status } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tax_documents")
    .update({ status })
    .eq("id", id)
    .select("id");
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "tax_documents.status.rejected",
      userId: ctx.userId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("tax_documents.status.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo cambiar el estado del impuesto." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "No encontramos el impuesto." };
  }
  await logAudit("tax_document.status_changed", ctx.userId, { status }, id);
  return { ok: true, data: undefined };
}

export async function payTaxDocumentAction(
  input: unknown,
): Promise<ActionResult<{ transactionId: string }>> {
  const ctx = await requireUserContext();
  // Paying books a Caja outflow, so it also needs transactions:write (as
  // linking and undoing a payment do).
  if (
    !userCan(ctx.access, "taxes:write") ||
    !userCan(ctx.access, "transactions:write")
  ) {
    return { ok: false, error: "No tenés permiso para pagar impuestos." };
  }
  const parsed = PayTaxDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, paid_date, account_id, amount } = parsed.data;

  const supabase = await createClient();
  // One transaction: claims the open document (FOR UPDATE), books the
  // outflow in the fiscal channel and posts it against the tax account.
  const { data: transactionId, error } = await supabase.rpc(
    "pay_tax_document",
    {
      p_tax_document_id: id,
      p_paid_date: paid_date,
      p_account_id: account_id,
      p_amount: amount,
    },
  );
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "tax_documents.pay.rejected",
      userId: ctx.userId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("tax_documents.pay.failed", { userId: ctx.userId, id, error });
    return { ok: false, error: "No se pudo registrar el pago del impuesto." };
  }
  await logAudit(
    "tax_document.paid",
    ctx.userId,
    { amount, transaction_id: transactionId },
    id,
  );
  return { ok: true, data: { transactionId } };
}

/**
 * Creates the documents of `period` that the previous period had (kind,
 * title, jurisdiction and account), each due one month after its previous
 * due date, without amount. What `period` already has is skipped, so running
 * it twice creates nothing new.
 */
export async function copyTaxDocumentsFromPreviousAction(
  input: unknown,
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "taxes:write")) {
    return { ok: false, error: "No tenés permiso para cargar impuestos." };
  }
  const parsed = CopyTaxPeriodSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { period } = parsed.data;
  const source = previousPeriod(period);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tax_documents")
    .select("kind, title, jurisdiction, period, due_date, account_id")
    .in("period", [source, period])
    .neq("status", "anulado")
    .order("due_date", { ascending: true })
    .limit(500);
  if (error) {
    logger.error("tax_documents.copy.read_failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron leer los impuestos." };
  }
  const key = (r: {
    kind: string;
    title: string | null;
    jurisdiction: string | null;
  }) => `${r.kind}|${r.jurisdiction ?? ""}|${r.title ?? ""}`;
  const existing = new Set(
    (data ?? []).filter((r) => r.period === period).map(key),
  );
  const previous = (data ?? []).filter((r) => r.period === source);
  const inserts = previous
    .filter((r) => !existing.has(key(r)))
    .map((r) => ({
      kind: r.kind,
      title: r.title,
      jurisdiction: r.jurisdiction,
      period,
      due_date: addOneMonth(r.due_date),
      account_id: r.account_id,
      created_by: ctx.userId,
    }));
  if (inserts.length === 0) {
    return {
      ok: true,
      data: { created: 0, skipped: previous.length },
    };
  }
  const { error: insertError } = await supabase
    .from("tax_documents")
    .insert(inserts);
  if (insertError) {
    if (insertError.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error:
          "Otro usuario cargó impuestos de ese período al mismo tiempo. Actualizá la página y probá de nuevo.",
      };
    }
    const guardError = mapDbGuardError(insertError, {
      slug: "tax_documents.copy.rejected",
      userId: ctx.userId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("tax_documents.copy.failed", {
      userId: ctx.userId,
      error: insertError,
    });
    return { ok: false, error: "No se pudieron copiar los impuestos." };
  }
  await logAudit("tax_document.copied", ctx.userId, {
    period,
    from: source,
    created: inserts.length,
  });
  return {
    ok: true,
    data: {
      created: inserts.length,
      skipped: previous.length - inserts.length,
    },
  };
}
