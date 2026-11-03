"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { addDaysIso } from "@/lib/date-range";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import {
  isTaxKind,
  LINK_CANDIDATE_DAY_WINDOW,
  LINK_CANDIDATES_PAGE_SIZE,
  LinkTaxPaymentSchema,
  rankTaxPaymentCandidates,
  TaxPaymentCandidatesSchema,
  taxDocumentLabel,
  type PayableTaxDocument,
  type TaxPaymentCandidatesPage,
} from "../schema";

/** Movements one candidates read drains; past this the window is too busy
 *  to rank, and the screen says so. */
const MAX_CANDIDATE_ROWS = 2_000;

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

/**
 * The movements a tax document can adopt as its payment: loose expenses
 * (no owning document) of an active cash or bank account in pesos, in the
 * fiscal channel, dated within LINK_CANDIDATE_DAY_WINDOW days of the due
 * date; closest amount first, one page at a time. link_tax_document_payment
 * re-checks all of it.
 */
export async function listTaxPaymentCandidatesAction(
  input: unknown,
): Promise<ActionResult<TaxPaymentCandidatesPage>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.access, "taxes:write") ||
    !userCan(ctx.access, "transactions:read")
  ) {
    return {
      ok: false,
      error: "No tenés permiso para vincular pagos de impuestos.",
    };
  }
  const parsed = TaxPaymentCandidatesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, page } = parsed.data;
  const service = getServiceClient();

  const docRes = await service
    .from("tax_documents")
    .select("id, status, amount, due_date")
    .eq("id", id)
    .maybeSingle();
  if (docRes.error) {
    logger.error("tax_documents.candidates.doc_failed", {
      userId: ctx.userId,
      id,
      error: docRes.error,
    });
    return { ok: false, error: "No se pudo leer el impuesto." };
  }
  if (!docRes.data) return { ok: false, error: "No encontramos el impuesto." };
  const doc = docRes.data;
  if (doc.status !== "pendiente" && doc.status !== "liquidado") {
    return { ok: false, error: "El impuesto ya está pagado o anulado." };
  }

  const accRes = await service
    .from("accounts")
    .select("id, name")
    .eq("is_active", true)
    .eq("currency", "ARS")
    .in("type", ["bank", "cash"])
    .order("name")
    .order("id");
  if (accRes.error) {
    logger.error("tax_documents.candidates.accounts_failed", {
      userId: ctx.userId,
      id,
      error: accRes.error,
    });
    return { ok: false, error: "No se pudieron leer las cuentas." };
  }
  const accountName = new Map(accRes.data.map((a) => [a.id, a.name]));
  const empty = {
    items: [],
    total: 0,
    page,
    page_size: LINK_CANDIDATES_PAGE_SIZE,
  };
  if (accountName.size === 0) return { ok: true, data: empty };

  const txRes = await paginateRange(
    (from, to) =>
      service
        .from("v_transactions_tagged")
        .select("id, account_id, transaction_date, amount, description")
        .eq("kind", "expense")
        .eq("currency", "ARS")
        .eq("channel_is_fiscal", true)
        .is("source_document", null)
        .in("account_id", [...accountName.keys()])
        .gte(
          "transaction_date",
          addDaysIso(doc.due_date, -LINK_CANDIDATE_DAY_WINDOW),
        )
        .lte(
          "transaction_date",
          addDaysIso(doc.due_date, LINK_CANDIDATE_DAY_WINDOW),
        )
        .order("transaction_date")
        .order("id")
        .range(from, to),
    undefined,
    MAX_CANDIDATE_ROWS,
  );
  if (txRes.error) {
    const capped = txRes.error.code === "row_cap";
    logger.error("tax_documents.candidates.read_failed", {
      userId: ctx.userId,
      id,
      error: txRes.error,
    });
    return {
      ok: false,
      error: capped
        ? "Hay demasiados egresos cerca del vencimiento para listarlos."
        : "No se pudieron leer los movimientos.",
    };
  }

  const rows = txRes.data.flatMap((t) => {
    const name = t.account_id ? accountName.get(t.account_id) : undefined;
    return t.id && t.transaction_date && t.amount !== null && name
      ? [
          {
            id: t.id,
            transaction_date: t.transaction_date,
            amount: Number(t.amount),
            description: t.description,
            account_name: name,
          },
        ]
      : [];
  });
  const ranked = rankTaxPaymentCandidates(rows, {
    amount: doc.amount === null ? null : Number(doc.amount),
    due_date: doc.due_date,
  });
  const start = page * LINK_CANDIDATES_PAGE_SIZE;
  return {
    ok: true,
    data: {
      ...empty,
      items: ranked.slice(start, start + LINK_CANDIDATES_PAGE_SIZE),
      total: ranked.length,
    },
  };
}

/** Pays the document with a loose expense already in Caja: the movement is
 *  owned by the document and its entry debits the document's account. */
export async function linkTaxDocumentPaymentAction(
  input: unknown,
): Promise<ActionResult<{ transactionId: string }>> {
  const ctx = await requireUserContext();
  if (
    !userCan(ctx.access, "taxes:write") ||
    !userCan(ctx.access, "transactions:write")
  ) {
    return {
      ok: false,
      error: "No tenés permiso para vincular pagos de impuestos.",
    };
  }
  const parsed = LinkTaxPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, transaction_id, allow_difference } = parsed.data;

  const { data: transactionId, error } = await getServiceClient().rpc(
    "link_tax_document_payment",
    {
      p_tax_document_id: id,
      p_transaction_id: transaction_id,
      p_user_id: ctx.userId,
      p_allow_difference: allow_difference,
    },
  );
  if (error || !transactionId) {
    const guardError = mapDbGuardError(error, {
      slug: "tax_documents.link.rejected",
      userId: ctx.userId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("tax_documents.link.failed", {
      userId: ctx.userId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo vincular el movimiento." };
  }
  await logAudit(
    "tax_document.payment_linked",
    ctx.userId,
    { transaction_id: transactionId, allow_difference },
    id,
  );
  return { ok: true, data: { transactionId } };
}

/** Open documents with their account set, by due date: the ones a bank
 *  statement debit can pay (Conciliación › Crear movimiento). */
export async function listPayableTaxDocumentsAction(): Promise<
  ActionResult<PayableTaxDocument[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "taxes:write")) {
    return { ok: false, error: "No tenés permiso para pagar impuestos." };
  }
  const { data, error } = await getServiceClient()
    .from("tax_documents")
    .select("id, kind, title, jurisdiction, period, due_date, amount")
    .in("status", ["pendiente", "liquidado"])
    .not("account_id", "is", null)
    .order("due_date")
    .order("id")
    .limit(500);
  if (error) {
    logger.error("tax_documents.payable.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron leer los impuestos." };
  }
  return {
    ok: true,
    data: data.flatMap((d) =>
      isTaxKind(d.kind)
        ? [
            {
              id: d.id,
              label: taxDocumentLabel({
                kind: d.kind,
                title: d.title,
                jurisdiction: d.jurisdiction,
              }),
              period: d.period,
              due_date: d.due_date,
              amount: d.amount === null ? null : Number(d.amount),
            },
          ]
        : [],
    ),
  };
}
