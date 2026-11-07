"use server";

import { isIvaCondition } from "@/features/clients/schema";
import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import {
  TREASURY_PERMISSIONS,
  userCan,
  userCanAll,
} from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { fetchInChunks } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { PRESET_CODES, cuitsIn } from "../lib/bank-codes";
import {
  BANK_TAX_ROLES,
  DeleteBankStatementCodeSchema,
  PresetBankStatementCodesSchema,
  SaveBankStatementCodeSchema,
  StatementCodingInputSchema,
  bankCodePosts,
  isBankCodeKind,
  type BankStatementCode,
  type PostingAccount,
  type StatementCoding,
  type StatementCardStatement,
  type StatementCheckSaleTransfer,
  type StatementLoanInstallment,
} from "../schema";

const READ_DENIED = "No tenés permiso para ver la conciliación.";
const WRITE_DENIED = "No tenés permiso para configurar los códigos del banco.";

type Service = ReturnType<typeof getServiceClient>;

async function readCodes(
  service: Service,
  accountId: string,
): Promise<BankStatementCode[] | null> {
  const { data, error } = await service
    .from("bank_statement_codes")
    .select(
      "id, account_id, bank_code, description_pattern, kind, chart_account_id, label, chart_of_accounts ( code, name )",
    )
    .eq("account_id", accountId)
    .order("bank_code")
    .order("description_pattern");
  if (error) return null;
  return data.flatMap((c): BankStatementCode[] => {
    if (!isBankCodeKind(c.kind)) return [];
    const chart = c.chart_of_accounts;
    return [
      {
        id: c.id,
        account_id: c.account_id,
        bank_code: c.bank_code,
        description_pattern: c.description_pattern,
        kind: c.kind,
        chart_account_id: c.chart_account_id,
        chart_account_label: chart ? `${chart.code} ${chart.name}` : null,
        label: c.label,
      },
    ];
  });
}

async function readPostingAccounts(
  service: Service,
): Promise<PostingAccount[] | null> {
  const [leaves, taxes] = await Promise.all([
    service
      .from("expense_leaf_accounts")
      .select("id, code, name")
      .order("code"),
    service
      .from("chart_of_accounts")
      .select("id, code, name")
      .eq("is_active", true)
      .in("system_role", [...BANK_TAX_ROLES])
      .order("code"),
  ]);
  if (leaves.error || taxes.error) return null;
  return [
    ...taxes.data.map((a) => ({ ...a, group: "tax" as const })),
    ...leaves.data.flatMap((a) =>
      a.id && a.code && a.name
        ? [{ id: a.id, code: a.code, name: a.name, group: "expense" as const }]
        : [],
    ),
  ];
}

/** The pending cuotas of the active loans debited from the account. */
async function readLoanInstallments(
  service: Service,
  accountId: string,
): Promise<StatementLoanInstallment[] | null> {
  const { data, error } = await service
    .from("loan_installments")
    .select(
      "id, number, due_date, amount, capital_amount, iva_amount, loan:loans!inner ( description, installments_count, account_id, status )",
    )
    .eq("status", "pendiente")
    .eq("loan.account_id", accountId)
    .eq("loan.status", "active")
    .order("due_date")
    .limit(500);
  if (error) return null;
  // The bank's taxes on interest move over time: the last paid cuota of
  // these loans that had them gives the current rate.
  const last = await service
    .from("loan_installments")
    .select(
      "interest_amount, perception_amount, loan:loans!inner ( account_id )",
    )
    .eq("status", "pagada")
    .eq("loan.account_id", accountId)
    .gt("perception_amount", 0)
    .gt("interest_amount", 0)
    .order("paid_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last.error) return null;
  // The bank states it with two decimals of a percent (1,6 %, 3,03 %); the
  // cuota's rounded amounts would shift it by a few cents.
  const tax_rate = last.data
    ? Math.round(
        (Number(last.data.perception_amount) /
          Number(last.data.interest_amount)) *
          10_000,
      ) / 10_000
    : null;
  return data.flatMap((i) => {
    const loan = Array.isArray(i.loan) ? i.loan[0] : i.loan;
    if (!loan) return [];
    return [
      {
        id: i.id,
        loan_description: loan.description,
        number: i.number,
        count: loan.installments_count,
        due_date: i.due_date,
        amount: Number(i.amount),
        capital: Number(i.capital_amount ?? i.amount),
        iva: Number(i.iva_amount ?? 0),
        tax_rate,
      },
    ];
  });
}

/** The account's bank codes, the accounts they can post to, and the
 *  clients whose CUIT appears in the period's lines. */
export async function getStatementCodingAction(
  input: unknown,
): Promise<ActionResult<StatementCoding>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:read")) {
    return { ok: false, error: READ_DENIED };
  }
  const parsed = StatementCodingInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { account_id, from, to } = parsed.data;
  const service = getServiceClient();

  const [codes, postingAccounts, lines, company] = await Promise.all([
    readCodes(service, account_id),
    readPostingAccounts(service),
    service
      .from("bank_statement_lines")
      .select("description")
      .eq("account_id", account_id)
      .eq("status", "open")
      .gte("line_date", from)
      .lte("line_date", to)
      .limit(5000),
    service.from("business_units").select("cuit").limit(1).maybeSingle(),
  ]);
  if (!codes || !postingAccounts || lines.error) {
    logger.error("reconciliation.coding.read_failed", {
      userId: ctx.userId,
      account_id,
    });
    return { ok: false, error: "No se pudieron leer los códigos del banco." };
  }

  const canReadClients = userCan(ctx.access, "clients:read");
  let clients: StatementCoding["clients"] = [];
  if (canReadClients) {
    const cuits = [
      ...new Set(lines.data.flatMap((l) => cuitsIn(l.description))),
    ];
    const res = await fetchInChunks(cuits, (chunk) =>
      service
        .from("clients")
        .select("id, cuit, legal_name, display_name, iva_condition, is_fiscal")
        .in("cuit", chunk),
    );
    if (res.error) {
      logger.error("reconciliation.coding.clients_failed", {
        userId: ctx.userId,
        account_id,
      });
      return { ok: false, error: "No se pudieron buscar los clientes." };
    }
    clients = res.data.flatMap((c) =>
      c.cuit
        ? [
            {
              id: c.id,
              cuit: c.cuit,
              legal_name: c.legal_name,
              display_name: c.display_name,
              iva_condition: isIvaCondition(c.iva_condition)
                ? c.iva_condition
                : null,
              is_fiscal: c.is_fiscal,
            },
          ]
        : [],
    );
  }

  let loanInstallments: StatementLoanInstallment[] = [];
  if (userCanAll(ctx.access, TREASURY_PERMISSIONS)) {
    const read = await readLoanInstallments(service, account_id);
    if (!read) {
      logger.error("reconciliation.coding.loans_failed", {
        userId: ctx.userId,
        account_id,
      });
      return {
        ok: false,
        error: "No se pudieron leer las cuotas de préstamos.",
      };
    }
    loanInstallments = read;
  }

  const [saleTransfers, cardStatements] = await Promise.all([
    readCheckSaleTransfers(service, account_id),
    readCardStatements(service, account_id),
  ]);
  if (!saleTransfers || !cardStatements) {
    logger.error("reconciliation.coding.check_sales_failed", {
      userId: ctx.userId,
      account_id,
    });
    return {
      ok: false,
      error: "No se pudieron leer las ventas de cheques.",
    };
  }

  return {
    ok: true,
    data: {
      codes,
      posting_accounts: postingAccounts,
      clients,
      can_read_clients: canReadClients,
      loan_installments: loanInstallments,
      company_cuit: company.data?.cuit ?? null,
      check_sale_transfers: saleTransfers,
      card_statements: cardStatements,
    },
  };
}

/** The card statements this account pays with a part not paid yet. */
async function readCardStatements(
  service: Service,
  accountId: string,
): Promise<StatementCardStatement[] | null> {
  const { data, error } = await service
    .from("card_statements")
    .select(
      "id, brand, account_number, close_date, due_date, total_ars, total_usd, paid_ars_on, paid_usd_on",
    )
    .eq("pay_account_id", accountId)
    .eq("status", "pendiente")
    .order("due_date")
    .limit(50);
  if (error) return null;
  return data.map((s) => ({
    id: s.id,
    label: `${s.brand} ${s.account_number} cierre ${s.close_date.split("-").reverse().join("/")}`,
    due_date: s.due_date,
    total_ars: Number(s.total_ars),
    total_usd: Number(s.total_usd),
    ars_pending: s.paid_ars_on === null,
    usd_pending: Number(s.total_usd) > 0 && s.paid_usd_on === null,
  }));
}

/** The transfers of cheques sold to a bank into the account that no
 *  statement line explains yet. */
async function readCheckSaleTransfers(
  service: Service,
  accountId: string,
): Promise<StatementCheckSaleTransfer[] | null> {
  const { data, error } = await service
    .from("transactions")
    .select(
      "id, check_sale_id, transaction_date, amount, description, bank_statement_matches ( id )",
    )
    .eq("account_id", accountId)
    .eq("kind", "transfer_in")
    .not("check_sale_id", "is", null)
    .order("transaction_date", { ascending: false })
    .limit(500);
  if (error) return null;
  return data.flatMap((t) =>
    t.check_sale_id && t.bank_statement_matches.length === 0
      ? [
          {
            id: t.id,
            sale_id: t.check_sale_id,
            date: t.transaction_date,
            amount: Number(t.amount),
            description: t.description ?? "",
          },
        ]
      : [],
  );
}

/** Creates or updates what a bank code is for an account. */
export async function saveBankStatementCodeAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = SaveBankStatementCodeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const d = parsed.data;
  const service = getServiceClient();
  const chartAccountId = bankCodePosts(d.kind)
    ? (d.chart_account_id ?? null)
    : null;
  if (chartAccountId) {
    const allowed = await readPostingAccounts(service);
    if (!allowed) {
      return { ok: false, error: "No se pudieron leer las cuentas contables." };
    }
    if (!allowed.some((a) => a.id === chartAccountId)) {
      return {
        ok: false,
        error:
          "La cuenta tiene que ser una cuenta hoja de gasto o una de impuestos a favor.",
      };
    }
  }
  const row = {
    account_id: d.account_id,
    bank_code: d.bank_code,
    description_pattern: d.description_pattern,
    kind: d.kind,
    chart_account_id: chartAccountId,
    label: d.label ?? null,
  };
  const res = d.id
    ? await service
        .from("bank_statement_codes")
        .update(row)
        .eq("id", d.id)
        .eq("account_id", d.account_id)
        .select("id")
        .maybeSingle()
    : await service
        .from("bank_statement_codes")
        .insert({ ...row, created_by: ctx.userId })
        .select("id")
        .single();
  if (res.error || !res.data) {
    if (res.error?.code === "23505") {
      return {
        ok: false,
        error: "Ese código (con ese texto) ya está configurado en la cuenta.",
      };
    }
    const guard = mapDbGuardError(res.error, {
      slug: "reconciliation.code.save_rejected",
      userId: ctx.userId,
    });
    if (!guard) {
      logger.error("reconciliation.code.save_failed", {
        userId: ctx.userId,
        account_id: d.account_id,
        error: res.error,
      });
    }
    return { ok: false, error: guard ?? "No se pudo guardar el código." };
  }
  await logAudit(
    "bank_statement_code.saved",
    ctx.userId,
    { account_id: d.account_id, bank_code: d.bank_code, kind: d.kind },
    res.data.id,
  );
  return { ok: true, data: { id: res.data.id } };
}

export async function deleteBankStatementCodeAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = DeleteBankStatementCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { error, data } = await getServiceClient()
    .from("bank_statement_codes")
    .delete()
    .eq("id", parsed.data.id)
    .select("id, bank_code")
    .maybeSingle();
  if (error) {
    logger.error("reconciliation.code.delete_failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo borrar el código." };
  }
  if (!data) return { ok: false, error: "El código ya no existe." };
  await logAudit(
    "bank_statement_code.deleted",
    ctx.userId,
    { bank_code: data.bank_code },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}

/** Loads a bank's known codes into the account; codes already there stay. */
export async function presetBankStatementCodesAction(
  input: unknown,
): Promise<ActionResult<{ inserted: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = PresetBankStatementCodesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { account_id, preset } = parsed.data;
  const service = getServiceClient();
  const chart = await service
    .from("chart_of_accounts")
    .select("id, code, system_role")
    .eq("is_active", true);
  if (chart.error) {
    logger.error("reconciliation.code.preset_read_failed", {
      userId: ctx.userId,
      error: chart.error,
    });
    return { ok: false, error: "No se pudo leer el plan de cuentas." };
  }
  const byCode = new Map(chart.data.map((a) => [a.code, a.id]));
  const byRole = new Map<string, string>(
    chart.data.flatMap((a) => (a.system_role ? [[a.system_role, a.id]] : [])),
  );
  const preset_codes = PRESET_CODES[preset];
  const rows = preset_codes.map((c) => ({
    account_id,
    bank_code: c.bank_code,
    description_pattern: c.description_pattern,
    kind: c.kind,
    label: c.label,
    chart_account_id: !c.account
      ? null
      : "code" in c.account
        ? (byCode.get(c.account.code) ?? null)
        : (byRole.get(c.account.role) ?? null),
    created_by: ctx.userId,
  }));
  const { data, error } = await service
    .from("bank_statement_codes")
    .upsert(rows, {
      onConflict: "account_id,bank_code,description_pattern",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) {
    logger.error("reconciliation.code.preset_failed", {
      userId: ctx.userId,
      account_id,
      error,
    });
    return { ok: false, error: "No se pudieron cargar los códigos." };
  }
  await logAudit(
    "bank_statement_code.preset",
    ctx.userId,
    { preset, inserted: data.length },
    account_id,
  );
  return { ok: true, data: { inserted: data.length } };
}
