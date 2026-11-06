"use server";

import { logAudit } from "@/lib/actions/audit";
import { createManualCheck } from "@/lib/commands/create-manual-check";
import { depositCheck } from "@/lib/commands/deposit-check";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import { applyFiscalFilter } from "@/lib/supabase/fiscal-filter";
import {
  mergeOpenAndRecent,
  SETTLED_LIST_CAP,
} from "@/lib/supabase/open-and-recent";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  CHECK_CASH_DENIED_REASON,
  CHECK_CASH_PERMISSIONS,
} from "../lib/check-cash";
import {
  CHECK_STATUSES,
  CreditChequeSchema,
  DepositChequeSchema,
  isChequeCurrency,
  isChequeKind,
  isChequeStatus,
  ManualChequeCreateSchema,
  OPEN_CHECK_STATUSES,
  RejectChequeSchema,
  SellChequesSchema,
  type Cheque,
  type SellChequesInput,
  type CheckMovement,
} from "../schema";

function narrowCheck(row: {
  kind: string;
  status: string;
  currency: string;
  [key: string]: unknown;
}): Cheque | null {
  if (!isChequeKind(row.kind)) {
    logger.error("cheques.unknown_kind", { value: row.kind });
    return null;
  }
  if (!isChequeStatus(row.status)) {
    logger.error("cheques.unknown_status", { value: row.status });
    return null;
  }
  if (!isChequeCurrency(row.currency)) {
    logger.error("cheques.unknown_currency", { value: row.currency });
    return null;
  }
  return row as Cheque;
}

const CHECK_COLUMNS =
  "id, kind, check_number, bank_name, drawer_name, drawer_cuit, issue_date, due_date, amount, currency, source_kind, source_receipt_id, source_payment_line_id, source_client_id, cartera_account_id, channel_id, status, notes, created_by, created_at, updated_at";

/** Embedded joins in check select queries: cartera_account always,
 *  source_client optional depending on whether the check came from a receipt. */
type CarteraAccountJoin = { cartera_account: { name: string } | null };
type SourceClientLegalJoin = {
  source_client: { legal_name: string } | null;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface CheckListItem extends Cheque {
  cartera_account_name: string;
  source_client_legal_name: string | null;
}

/** Open checks (depositar, endosar, vender, acreditar) are always listed in
 *  full. An endorsed or sold check can still be rejected but sits with the
 *  settled ones, whose cap keeps the latest due dates (the window a bounce
 *  arrives in). */
const SETTLED_CHECK_STATUSES = CHECK_STATUSES.filter(
  (s) => !(OPEN_CHECK_STATUSES as readonly string[]).includes(s),
);

/** `isFiscal` (`isFiscalFor`): null/undefined = every check, those with no
 *  channel included; a boolean drops the checks without a channel. Every
 *  check in cartera or deposited, plus the latest SETTLED_LIST_CAP others by
 *  due date; `truncated` = older settled checks were left out. */
export async function listChecksAction(input?: {
  isFiscal?: boolean | null;
}): Promise<ActionResult<{ items: CheckListItem[]; truncated: boolean }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:read")) {
    return { ok: false, error: "No tenés permiso para ver cheques." };
  }

  const supabase = await createSupabaseClient();
  const base = () =>
    applyFiscalFilter(
      supabase.from("checks").select(
        `${CHECK_COLUMNS},
       cartera_account:accounts!checks_cartera_account_id_fkey(name),
       source_client:clients(legal_name),
       channel:invoicing_channels(is_fiscal)`,
      ),
      input?.isFiscal,
      "channel",
    );
  const [open, settled] = await Promise.all([
    paginateRange((from, to) =>
      base()
        .in("status", [...OPEN_CHECK_STATUSES])
        .order("due_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    base()
      .in("status", SETTLED_CHECK_STATUSES)
      .order("due_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(SETTLED_LIST_CAP + 1),
  ]);

  const error = open.error ?? settled.error;
  if (error) {
    logger.error("cheques.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los cheques." };
  }
  const { rows, truncated } = mergeOpenAndRecent(
    open.data ?? [],
    settled.data ?? [],
  );

  const items: CheckListItem[] = rows
    .map((row) => {
      const narrowed = narrowCheck(row);
      if (!narrowed) return null;
      const cartera = (row as CarteraAccountJoin).cartera_account;
      const sourceClient = (row as SourceClientLegalJoin).source_client;
      return {
        ...narrowed,
        cartera_account_name: cartera?.name ?? "—",
        source_client_legal_name: sourceClient?.legal_name ?? null,
      };
    })
    .filter((c): c is CheckListItem => c !== null);

  return { ok: true, data: { items, truncated } };
}

export type EnCarteraCheck = {
  id: string;
  kind: "fisico" | "echeq";
  check_number: string;
  bank_name: string;
  drawer_name: string;
  due_date: string;
  amount: number;
  currency: "ARS" | "USD";
  cartera_account_id: string;
  cartera_account_name: string;
  channel_id: string | null;
};

export async function listEnCarteraChecksAction(filters?: {
  currency?: "ARS" | "USD";
}): Promise<ActionResult<EnCarteraCheck[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:read")) {
    return { ok: false, error: "No tenés permiso para ver cheques." };
  }
  const supabase = await createSupabaseClient();
  let query = supabase
    .from("checks")
    .select(
      "id, kind, check_number, bank_name, drawer_name, due_date, amount, currency, cartera_account_id, channel_id, cartera_account:accounts!checks_cartera_account_id_fkey(name)",
    )
    .eq("status", "en_cartera")
    .order("due_date", { ascending: true });
  if (filters?.currency) query = query.eq("currency", filters.currency);

  const { data, error } = await query;
  if (error) {
    logger.error("cheques.en_cartera.list.failed", {
      userId: ctx.userId,
      currency: filters?.currency,
      error,
    });
    return { ok: false, error: "No se pudieron listar cheques en cartera." };
  }
  const items: EnCarteraCheck[] = (data ?? [])
    .filter(
      (row): row is typeof row & { kind: "fisico" | "echeq" } =>
        row.kind === "fisico" || row.kind === "echeq",
    )
    .filter(
      (row): row is typeof row & { currency: "ARS" | "USD" } =>
        row.currency === "ARS" || row.currency === "USD",
    )
    .map((row) => {
      const acct = (row as CarteraAccountJoin).cartera_account;
      return {
        id: row.id,
        kind: row.kind,
        check_number: row.check_number,
        bank_name: row.bank_name,
        drawer_name: row.drawer_name,
        due_date: row.due_date,
        amount: Number(row.amount),
        currency: row.currency,
        cartera_account_id: row.cartera_account_id,
        cartera_account_name: acct?.name ?? "—",
        channel_id: row.channel_id,
      };
    });
  return { ok: true, data: items };
}

export interface ChequeDetail {
  check: Cheque;
  movements: CheckMovement[];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createCheckAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:write")) {
    return { ok: false, error: "No tenés permiso para registrar cheques." };
  }
  if (!userCanAll(ctx.access, CHECK_CASH_PERMISSIONS)) {
    return { ok: false, error: CHECK_CASH_DENIED_REASON };
  }

  const parsed = ManualChequeCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseClient();
  // A check lives in a cartera account: loaded into a bank or cash account it
  // would book its inflow there (guard_check_edit refuses it too).
  const { data: cartera, error: carteraErr } = await supabase
    .from("accounts")
    .select("type")
    .eq("id", data.cartera_account_id)
    .maybeSingle();
  if (carteraErr) {
    logger.error("cheques.create.cartera_read_failed", {
      userId: ctx.userId,
      error: carteraErr,
    });
    return { ok: false, error: "No se pudo leer la cuenta de cartera." };
  }
  if (!cartera || (cartera.type !== "checks" && cartera.type !== "echeq")) {
    return { ok: false, error: "La cuenta de cartera no es válida." };
  }

  return createManualCheck(ctx.userId, data);
}

export async function depositCheckAction(
  input: unknown,
): Promise<ActionResult<{ movement_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:write")) {
    return { ok: false, error: "No tenés permiso para depositar cheques." };
  }
  if (!userCanAll(ctx.access, CHECK_CASH_PERMISSIONS)) {
    return { ok: false, error: CHECK_CASH_DENIED_REASON };
  }

  const parsed = DepositChequeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return depositCheck(ctx.userId, parsed.data);
}

export async function creditCheckAction(
  input: unknown,
): Promise<ActionResult<{ movement_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:write")) {
    return { ok: false, error: "No tenés permiso para acreditar cheques." };
  }
  if (!userCanAll(ctx.access, CHECK_CASH_PERMISSIONS)) {
    return { ok: false, error: CHECK_CASH_DENIED_REASON };
  }

  const parsed = CreditChequeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseClient();
  const { data: id, error } = await supabase.rpc("credit_check", {
    p_check_id: data.check_id,
    p_event_date: data.event_date,
    p_notes: data.notes ?? "",
  });
  if (error) {
    const guard = mapDbGuardError(error, {
      slug: "cheques.credit.rejected",
      userId: ctx.userId,
      id: data.check_id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("cheques.credit.failed", {
      userId: ctx.userId,
      check_id: data.check_id,
      error,
    });
    return { ok: false, error: "No se pudo acreditar el cheque." };
  }

  await logAudit("check.credited", ctx.userId, {}, data.check_id);
  return { ok: true, data: { movement_id: id as string } };
}

export async function rejectCheckAction(
  input: unknown,
): Promise<ActionResult<{ movement_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:write")) {
    return { ok: false, error: "No tenés permiso para rechazar cheques." };
  }
  if (!userCanAll(ctx.access, CHECK_CASH_PERMISSIONS)) {
    return { ok: false, error: CHECK_CASH_DENIED_REASON };
  }

  const parsed = RejectChequeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseClient();
  // reject_check takes the outflow from the account the check is in (the
  // deposit's or the cartera) and refuses any other one.
  const { data: check, error: checkError } = await supabase
    .from("checks")
    .select(
      "status, cartera_account_id, check_movements(event, destination_account_id, created_at)",
    )
    .eq("id", data.check_id)
    .maybeSingle();
  if (checkError || !check) {
    logger.error("cheques.reject.load_failed", {
      userId: ctx.userId,
      check_id: data.check_id,
      error: checkError,
    });
    return { ok: false, error: "No se pudo cargar el cheque." };
  }
  const latestTo = (event: "deposited" | "sold") =>
    check.check_movements
      .filter((m) => m.event === event && m.destination_account_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      ?.destination_account_id ?? null;
  // A sold check comes back from the account the buyer is repaid from (by
  // default the sale's); a deposited one from the deposit's account.
  const fromAccount =
    check.status === "vendido"
      ? (data.account_id ?? latestTo("sold"))
      : check.status === "depositado"
        ? latestTo("deposited")
        : check.cartera_account_id;
  if (check.status === "depositado" && !fromAccount) {
    return {
      ok: false,
      error: "No se encontró la cuenta donde se depositó el cheque.",
    };
  }
  if (check.status === "vendido" && !fromAccount) {
    return {
      ok: false,
      error: "Elegí la cuenta de la que sale la devolución al comprador.",
    };
  }

  const { data: id, error } = await supabase.rpc("reject_check", {
    p_check_id: data.check_id,
    p_account_id: fromAccount ?? check.cartera_account_id,
    p_event_date: data.event_date,
    p_channel_id: data.channel_id,
    p_notes: data.notes ?? "",
  });
  if (error) {
    const guard = mapDbGuardError(error, {
      slug: "cheques.reject.rejected",
      userId: ctx.userId,
      id: data.check_id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("cheques.reject.failed", {
      userId: ctx.userId,
      check_id: data.check_id,
      error,
    });
    return { ok: false, error: "No se pudo rechazar el cheque." };
  }

  await logAudit("check.rejected", ctx.userId, {}, data.check_id);
  return { ok: true, data: { movement_id: id as string } };
}

/**
 * Venta (descuento) of cartera checks to a bank or financiera (sell_checks):
 * the checks leave the cartera as vendido, their face value goes to the
 * destination account, and the interest and commission leave it as expenses
 * imputed to Intereses pagados, so the account keeps the net. Idempotent on
 * the dialog's key. Gated on CHECK_CASH_PERMISSIONS.
 */
export async function sellChecksAction(
  input: SellChequesInput,
): Promise<ActionResult<{ sale_id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "cheques:write")) {
    return { ok: false, error: "No tenés permiso para vender cheques." };
  }
  if (!userCanAll(ctx.access, CHECK_CASH_PERMISSIONS)) {
    return { ok: false, error: CHECK_CASH_DENIED_REASON };
  }
  const parsed = SellChequesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const d = parsed.data;

  // Service role: sell_checks is granted to it alone, behind this gate.
  const { data: saleId, error } = await getServiceClient().rpc("sell_checks", {
    p_check_ids: d.check_ids,
    p_account_id: d.account_id,
    p_sale_date: d.sale_date,
    p_channel_id: d.channel_id,
    p_buyer_name: d.buyer_name,
    p_buyer_cuit: d.buyer_cuit ?? "",
    p_interest: d.interest,
    p_commission: d.commission,
    p_notes: d.notes ?? "",
    p_idempotency_key: d.idempotency_key,
    p_user_id: ctx.userId,
  });
  if (error || !saleId) {
    const guard = mapDbGuardError(error, {
      slug: "cheques.sell.rejected",
      userId: ctx.userId,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("cheques.sell.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo registrar la venta de cheques." };
  }

  await logAudit(
    "check_sale.created",
    ctx.userId,
    {
      check_ids: d.check_ids,
      account_id: d.account_id,
      buyer_name: d.buyer_name,
      interest: d.interest,
      commission: d.commission,
    },
    saleId,
  );
  return { ok: true, data: { sale_id: saleId } };
}
