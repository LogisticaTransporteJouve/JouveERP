"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { TREASURY_PERMISSIONS, userCanAll } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import {
  CreateCardStatementSchema,
  DeleteCardStatementSchema,
  SetCardHolderSchema,
  SetCardLinesSchema,
  isCardStatementStatus,
  isCardTreatment,
  type CardStatementDetail,
  type CardStatementListItem,
} from "../schema";

const READ_DENIED = "Sin permiso para ver tarjetas.";
const WRITE_DENIED = "Sin permiso para cargar resúmenes de tarjeta.";
// Reading and paying a card statement moves treasury money: the treasury
// permissions (transactions read and write, accounts read).
const canWrite = (access: Parameters<typeof userCanAll>[0]) =>
  userCanAll(access, TREASURY_PERMISSIONS);

type Service = ReturnType<typeof getServiceClient>;

/** Where each charge of the bank goes by default (by system role or code);
 *  sellos and anything unknown are left for the user. */
const CHARGE_ACCOUNT: Record<string, { role: string } | { code: string }> = {
  iva: { role: "iva_credito" },
  iva_perception: { role: "percepciones_iva_pagadas" },
  iibb_perception: { role: "percepciones_iibb_pagadas" },
  income_tax_perception: { role: "percepciones_ganancias" },
  interest: { role: "intereses_pagados" },
  fee: { code: "5.4.2" },
  stamp_tax: { code: "5.4.4" },
};

const STATEMENT_COLUMNS =
  "id, number, brand, account_number, close_date, due_date, total_ars, total_usd, status, paid_ars_on, paid_usd_on, account:accounts!card_statements_pay_account_id_fkey ( name )";

type StatementRow = {
  id: string;
  number: string;
  brand: string;
  account_number: string;
  close_date: string;
  due_date: string;
  total_ars: number;
  total_usd: number;
  status: string;
  paid_ars_on: string | null;
  paid_usd_on: string | null;
  account: { name: string } | { name: string }[] | null;
};

function toItem(s: StatementRow): CardStatementListItem {
  const account = Array.isArray(s.account) ? s.account[0] : s.account;
  return {
    id: s.id,
    number: s.number,
    brand: s.brand,
    account_number: s.account_number,
    pay_account_name: account?.name ?? "—",
    close_date: s.close_date,
    due_date: s.due_date,
    total_ars: Number(s.total_ars),
    total_usd: Number(s.total_usd),
    status: isCardStatementStatus(s.status) ? s.status : "pendiente",
    paid_ars_on: s.paid_ars_on,
    paid_usd_on: s.paid_usd_on,
  };
}

export async function listCardStatementsAction(): Promise<
  ActionResult<CardStatementListItem[]>
> {
  const ctx = await requireUserContext();
  if (!canWrite(ctx.access)) return { ok: false, error: READ_DENIED };
  const { data, error } = await getServiceClient()
    .from("card_statements")
    .select(STATEMENT_COLUMNS)
    .order("close_date", { ascending: false })
    .limit(200);
  if (error) {
    logger.error("cards.list_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron leer los resúmenes." };
  }
  return { ok: true, data: data.map(toItem) };
}

export async function getCardStatementAction(
  id: string,
): Promise<ActionResult<CardStatementDetail>> {
  const ctx = await requireUserContext();
  if (!canWrite(ctx.access)) return { ok: false, error: READ_DENIED };
  const parsed = DeleteCardStatementSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const service = getServiceClient();
  const st = await service
    .from("card_statements")
    .select(STATEMENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (st.error || !st.data) {
    if (st.error)
      logger.error("cards.read_failed", {
        userId: ctx.userId,
        error: st.error,
      });
    return { ok: false, error: "No se encontró el resumen." };
  }
  const [lines, holders, leaves, taxes, employees] = await Promise.all([
    service
      .from("card_statement_lines")
      .select(
        "id, source, card_last4, line_date, description, installment, currency, amount, treatment, chart_account_id, employee_id, transaction_id",
      )
      .eq("statement_id", id)
      .order("sort_order"),
    service
      .from("card_holders")
      .select("last4, holder, treatment, chart_account_id, employee_id")
      .eq("account_number", st.data.account_number),
    service
      .from("expense_leaf_accounts")
      .select("id, code, name")
      .order("code"),
    service
      .from("chart_of_accounts")
      .select("id, code, name")
      .eq("is_active", true)
      .in("system_role", [
        "iva_credito",
        "percepciones_iva_pagadas",
        "percepciones_iibb_pagadas",
        "percepciones_ganancias",
        "retenciones_pagadas",
      ])
      .order("code"),
    service
      .from("employees")
      .select("id, legal_name")
      .order("legal_name")
      .limit(1000),
  ]);
  if (
    lines.error ||
    holders.error ||
    leaves.error ||
    taxes.error ||
    employees.error
  ) {
    logger.error("cards.detail_failed", { userId: ctx.userId, id });
    return { ok: false, error: "No se pudo leer el resumen." };
  }
  return {
    ok: true,
    data: {
      statement: toItem(st.data),
      lines: lines.data.map((l) => ({
        id: l.id,
        source: l.source === "charge" ? "charge" : "purchase",
        card_last4: l.card_last4,
        line_date: l.line_date,
        description: l.description,
        installment: l.installment,
        currency: l.currency === "USD" ? "USD" : "ARS",
        amount: Number(l.amount),
        treatment: isCardTreatment(l.treatment) ? l.treatment : "expense",
        chart_account_id: l.chart_account_id,
        employee_id: l.employee_id,
        paid: l.transaction_id !== null,
      })),
      holders: holders.data.map((h) => ({
        last4: h.last4,
        holder: h.holder,
        treatment: isCardTreatment(h.treatment) ? h.treatment : "expense",
        chart_account_id: h.chart_account_id,
        employee_id: h.employee_id,
      })),
      accounts: [
        ...taxes.data,
        ...leaves.data.flatMap((a) =>
          a.id && a.code && a.name
            ? [{ id: a.id, code: a.code, name: a.name }]
            : [],
        ),
      ],
      employees: employees.data.map((e) => ({ id: e.id, name: e.legal_name })),
    },
  };
}

async function chargeAccounts(
  service: Service,
): Promise<Map<string, string> | null> {
  const { data, error } = await service
    .from("chart_of_accounts")
    .select("id, code, system_role")
    .eq("is_active", true);
  if (error) return null;
  const out = new Map<string, string>();
  for (const [kind, target] of Object.entries(CHARGE_ACCOUNT)) {
    const found = data.find((a) =>
      "role" in target ? a.system_role === target.role : a.code === target.code,
    );
    if (found) out.set(kind, found.id);
  }
  return out;
}

/** Loads a statement read from its PDF: its purchases with each card's
 *  default (remembered from earlier statements), its charges with their
 *  tax or fee account. Nothing posts until the bank debits the payment. */
export async function createCardStatementAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!canWrite(ctx.access)) return { ok: false, error: WRITE_DENIED };
  const parsed = CreateCardStatementSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { pay_account_id, statement: s } = parsed.data;
  const accountNumber = s.account_number ?? "—";
  const service = getServiceClient();

  const [existing, holders, charges] = await Promise.all([
    service
      .from("card_statements")
      .select("id")
      .eq("number", s.number)
      .maybeSingle(),
    service
      .from("card_holders")
      .select("last4, treatment, chart_account_id, employee_id")
      .eq("account_number", accountNumber),
    chargeAccounts(service),
  ]);
  if (existing.error || holders.error || !charges) {
    logger.error("cards.create_read_failed", { userId: ctx.userId });
    return { ok: false, error: "No se pudo cargar el resumen." };
  }
  if (existing.data) {
    return { ok: false, error: `El resumen ${s.number} ya está cargado.` };
  }

  // A card seen for the first time is remembered with its holder.
  const known = new Map(holders.data.map((h) => [h.last4, h]));
  const fresh = s.cards.filter((c) => !known.has(c.last4));
  if (fresh.length > 0) {
    const ins = await service.from("card_holders").insert(
      fresh.map((c) => ({
        account_number: accountNumber,
        last4: c.last4,
        holder: c.holder,
      })),
    );
    if (ins.error) {
      logger.error("cards.holders_insert_failed", {
        userId: ctx.userId,
        error: ins.error,
      });
      return { ok: false, error: "No se pudieron guardar las tarjetas." };
    }
  }

  const created = await service
    .from("card_statements")
    .insert({
      number: s.number,
      account_number: accountNumber,
      pay_account_id,
      close_date: s.close_date,
      due_date: s.due_date,
      total_ars: s.total_ars,
      total_usd: s.total_usd,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (created.error) {
    logger.error("cards.create_failed", {
      userId: ctx.userId,
      error: created.error,
    });
    return { ok: false, error: "No se pudo cargar el resumen." };
  }
  const id = created.data.id;

  let order = 0;
  const rows = [
    ...s.cards.flatMap((c) => {
      const h = known.get(c.last4);
      const treatment =
        h && isCardTreatment(h.treatment) ? h.treatment : "expense";
      return c.purchases.map((p) => ({
        statement_id: id,
        sort_order: order++,
        source: "purchase",
        card_last4: c.last4,
        line_date: p.date,
        description: p.description,
        installment: p.installment,
        currency: p.currency,
        amount: p.amount,
        treatment,
        chart_account_id:
          treatment === "expense" ? (h?.chart_account_id ?? null) : null,
        employee_id: treatment === "advance" ? (h?.employee_id ?? null) : null,
      }));
    }),
    ...s.charges.map((c) => ({
      statement_id: id,
      sort_order: order++,
      source: "charge",
      card_last4: null,
      line_date: c.date,
      description: c.description,
      installment: null,
      currency: "ARS",
      amount: c.amount,
      treatment: "expense",
      chart_account_id: charges.get(c.kind) ?? null,
      employee_id: null,
    })),
  ];
  const lines = await service.from("card_statement_lines").insert(rows);
  if (lines.error) {
    logger.error("cards.lines_failed", {
      userId: ctx.userId,
      error: lines.error,
    });
    await service.from("card_statements").delete().eq("id", id);
    return {
      ok: false,
      error: "No se pudieron guardar los consumos del resumen.",
    };
  }

  await logAudit(
    "card_statement.created",
    ctx.userId,
    {
      number: s.number,
      total_ars: s.total_ars,
      total_usd: s.total_usd,
      lines: rows.length,
    },
    id,
  );
  return { ok: true, data: { id } };
}

async function assertEditable(service: Service, statementId: string) {
  const { data, error } = await service
    .from("card_statements")
    .select("status")
    .eq("id", statementId)
    .maybeSingle();
  if (error || !data) return "No se encontró el resumen.";
  if (data.status === "pagado")
    return "El resumen ya está pagado: no se cambia.";
  return null;
}

/** What some lines are: a company expense (with its account), a salary
 *  advance (with its employee) or nothing. Paid lines stay as they are. */
export async function setCardLinesAction(
  input: unknown,
): Promise<ActionResult<{ updated: number }>> {
  const ctx = await requireUserContext();
  if (!canWrite(ctx.access)) return { ok: false, error: WRITE_DENIED };
  const parsed = SetCardLinesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const d = parsed.data;
  const service = getServiceClient();
  const blocked = await assertEditable(service, d.statement_id);
  if (blocked) return { ok: false, error: blocked };
  let update = service
    .from("card_statement_lines")
    .update({
      treatment: d.treatment,
      chart_account_id: d.treatment === "expense" ? d.chart_account_id : null,
      employee_id: d.treatment === "advance" ? d.employee_id : null,
    })
    .eq("statement_id", d.statement_id)
    .in("id", d.line_ids)
    .is("transaction_id", null);
  // A charge of the bank is never a salary advance.
  if (d.treatment === "advance") update = update.eq("source", "purchase");
  const { data, error } = await update.select("id");
  if (error) {
    logger.error("cards.lines_update_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cambiar los consumos." };
  }
  return { ok: true, data: { updated: data.length } };
}

/** A card's default: kept for the next statements, and applied now to its
 *  purchases of this statement not paid yet. */
export async function setCardHolderAction(
  input: unknown,
): Promise<ActionResult<{ updated: number }>> {
  const ctx = await requireUserContext();
  if (!canWrite(ctx.access)) return { ok: false, error: WRITE_DENIED };
  const parsed = SetCardHolderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const d = parsed.data;
  const service = getServiceClient();
  const st = await service
    .from("card_statements")
    .select("account_number, status")
    .eq("id", d.statement_id)
    .maybeSingle();
  if (st.error || !st.data)
    return { ok: false, error: "No se encontró el resumen." };
  const values = {
    treatment: d.treatment,
    chart_account_id: d.treatment === "expense" ? d.chart_account_id : null,
    employee_id: d.treatment === "advance" ? d.employee_id : null,
  };
  const holder = await service
    .from("card_holders")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("account_number", st.data.account_number)
    .eq("last4", d.last4);
  if (holder.error) {
    logger.error("cards.holder_update_failed", {
      userId: ctx.userId,
      error: holder.error,
    });
    return { ok: false, error: "No se pudo guardar la tarjeta." };
  }
  if (st.data.status === "pagado") return { ok: true, data: { updated: 0 } };
  const { data, error } = await service
    .from("card_statement_lines")
    .update(values)
    .eq("statement_id", d.statement_id)
    .eq("card_last4", d.last4)
    .is("transaction_id", null)
    .select("id");
  if (error) {
    logger.error("cards.holder_apply_failed", { userId: ctx.userId, error });
    return {
      ok: false,
      error: "Se guardó la tarjeta, pero no se aplicó a sus consumos.",
    };
  }
  await logAudit(
    "card_holder.updated",
    ctx.userId,
    { last4: d.last4, treatment: d.treatment, applied: data.length },
    d.statement_id,
  );
  return { ok: true, data: { updated: data.length } };
}

/** Deletes a statement loaded by mistake, while nothing of it is paid. */
export async function deleteCardStatementAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!canWrite(ctx.access)) return { ok: false, error: WRITE_DENIED };
  const parsed = DeleteCardStatementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const service = getServiceClient();
  const { data, error } = await service
    .from("card_statements")
    .delete()
    .eq("id", parsed.data.id)
    .is("paid_ars_on", null)
    .is("paid_usd_on", null)
    .select("id, number")
    .maybeSingle();
  if (error) {
    logger.error("cards.delete_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar el resumen." };
  }
  if (!data) {
    return {
      ok: false,
      error: "El resumen no existe o ya tiene un pago: no se borra.",
    };
  }
  await logAudit(
    "card_statement.deleted",
    ctx.userId,
    { number: data.number },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}
