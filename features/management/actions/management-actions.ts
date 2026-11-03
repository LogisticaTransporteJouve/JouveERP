"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { fiscalYearMonths } from "@/lib/fiscal-year";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import {
  DOC_TYPE_PERMISSIONS,
  drillDocuments,
  isManagementBucket,
  isSubbucket,
  lineBuckets,
  ManagementDrillInputSchema,
  ManagementExportInputSchema,
  narrowManagementDocuments,
  ManagementPnlInputSchema,
  ManagementReportInputSchema,
  narrowManagementRows,
  SetBucketSchema,
  toPayrollControlRow,
  type ManagementBucket,
  type ManagementCostCenter,
  type ManagementDrill,
  type ManagementRow,
  type RawManagementDocument,
  type PayrollControlRow,
  type Subbucket,
} from "../schema";

// The P&L RPCs are SECURITY DEFINER and revoked from authenticated (only the
// service role runs them): the gate is management:read here, per user.

const DENIED = "No tenés permiso para ver el resultado de gestión.";

const DRILL_PAGE = 1000;
const DRILL_READ_LIMIT = 20_000;

function endOfMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, "0")}`;
}

async function readPnl(
  userId: string,
  from: string,
  to: string,
  basis: "accrual" | "cash",
  inflation: boolean,
): Promise<ManagementRow[] | null> {
  const { data, error } = await getServiceClient().rpc("get_management_pnl", {
    p_from: `${from}-01`,
    p_to: endOfMonth(to),
    p_basis: basis,
    p_inflation: inflation,
  });
  if (error) {
    logger.error("management.pnl.failed", { userId, error });
    return null;
  }
  const { rows, unknown } = narrowManagementRows(data ?? []);
  if (unknown.length > 0) {
    logger.error("management.pnl.unknown_rows", {
      userId,
      count: unknown.length,
    });
  }
  return rows;
}

/** Rows of the management P&L for a range of months. Internal use only. */
export async function getManagementPnlAction(
  input: unknown,
): Promise<ActionResult<ManagementRow[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "management:read")) {
    return { ok: false, error: DENIED };
  }
  const parsed = ManagementPnlInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const v = parsed.data;
  const rows = await readPnl(
    ctx.userId,
    v.fromPeriod,
    v.toPeriod,
    v.basis,
    v.inflation,
  );
  if (!rows) {
    return { ok: false, error: "No se pudo calcular el resultado de gestión." };
  }
  return { ok: true, data: rows };
}

export type ManagementAccount = {
  id: string;
  code: string;
  name: string;
  isResult: boolean;
  bucket: ManagementBucket | null;
  subbucket: Subbucket | null;
};

export type ManagementReport = {
  months: string[];
  rows: ManagementRow[];
  previousRows: ManagementRow[];
  payroll: PayrollControlRow[];
  accounts: ManagementAccount[];
  /** Every cost center, inactive ones included (they name past rows). */
  costCenters: ManagementCostCenter[];
};

async function readCostCenters(
  userId: string,
): Promise<ManagementCostCenter[] | null> {
  const { data, error } = await getServiceClient()
    .from("cost_centers")
    .select("id, code, name")
    .order("code");
  if (error) {
    logger.error("management.cost_centers.failed", { userId, error });
    return null;
  }
  return data ?? [];
}

/** The cost centers the management rows name (management:read, so whoever
 *  reads gestión can name its centers without accounting:read). */
export async function listManagementCostCentersAction(): Promise<
  ActionResult<ManagementCostCenter[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "management:read")) {
    return { ok: false, error: DENIED };
  }
  const centers = await readCostCenters(ctx.userId);
  if (!centers) {
    return { ok: false, error: "No se pudieron leer los centros de costo." };
  }
  return { ok: true, data: centers };
}

async function readAccounts(
  userId: string,
): Promise<ManagementAccount[] | null> {
  const supabase = getServiceClient();
  const [coa, buckets] = await Promise.all([
    supabase
      .from("chart_of_accounts")
      .select("id, code, name, account_type")
      .eq("is_active", true)
      .order("code"),
    supabase
      .from("management_buckets")
      .select("chart_of_accounts_id, bucket, subbucket"),
  ]);
  if (coa.error || buckets.error) {
    logger.error("management.accounts.failed", {
      userId,
      error: coa.error ?? buckets.error,
    });
    return null;
  }
  const byAccount = new Map(
    (buckets.data ?? []).map((b) => [b.chart_of_accounts_id, b]),
  );
  return (coa.data ?? []).map((a) => {
    const b = byAccount.get(a.id);
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      isResult:
        a.account_type === "resultado_positivo" ||
        a.account_type === "resultado_negativo",
      bucket: b && isManagementBucket(b.bucket) ? b.bucket : null,
      subbucket: b && isSubbucket(b.subbucket) ? b.subbucket : null,
    };
  });
}

/** The screen's data: a fiscal year (Oct–Sep) month by month, the previous
 *  one for the comparison, the payroll control and the account catalog. */
export async function getManagementReportAction(
  input: unknown,
): Promise<ActionResult<ManagementReport>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "management:read")) {
    return { ok: false, error: DENIED };
  }
  const parsed = ManagementReportInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { fiscalYear, basis, inflation } = parsed.data;

  const months = fiscalYearMonths(fiscalYear);
  const previousMonths = fiscalYearMonths(fiscalYear - 1);
  const from = months[0]!;
  const to = months[11]!;

  const [rows, previousRows, payrollRes, accounts, costCenters] =
    await Promise.all([
      readPnl(ctx.userId, from, to, basis, inflation),
      readPnl(
        ctx.userId,
        previousMonths[0]!,
        previousMonths[11]!,
        basis,
        inflation,
      ),
      getServiceClient().rpc("get_management_payroll_control", {
        p_from: `${from}-01`,
        p_to: endOfMonth(to),
      }),
      readAccounts(ctx.userId),
      readCostCenters(ctx.userId),
    ]);
  if (payrollRes.error) {
    logger.error("management.payroll_control.failed", {
      userId: ctx.userId,
      error: payrollRes.error,
    });
  }
  if (!rows || !previousRows || !accounts || !costCenters || payrollRes.error) {
    return { ok: false, error: "No se pudo calcular el resultado de gestión." };
  }
  return {
    ok: true,
    data: {
      months,
      rows,
      previousRows,
      payroll: (payrollRes.data ?? []).map(toPayrollControlRow),
      accounts,
      costCenters,
    },
  };
}

/** Maps a chart account to a management bucket (owner and admin). */
export async function setManagementBucketAction(
  input: unknown,
): Promise<ActionResult<{ accountId: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "management:write")) {
    return {
      ok: false,
      error: "No tenés permiso para clasificar cuentas de gestión.",
    };
  }
  const parsed = SetBucketSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { accountId, bucket, subbucket } = parsed.data;
  const supabase = getServiceClient();

  const { data: before, error: readErr } = await supabase
    .from("management_buckets")
    .select("bucket, subbucket")
    .eq("chart_of_accounts_id", accountId)
    .maybeSingle();
  if (readErr) {
    logger.error("management.bucket.read_failed", {
      userId: ctx.userId,
      id: accountId,
      error: readErr,
    });
    return { ok: false, error: "No se pudo leer la clasificación." };
  }

  const { error } = await supabase.from("management_buckets").upsert({
    chart_of_accounts_id: accountId,
    bucket,
    subbucket,
    updated_by: ctx.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    logger.error("management.bucket.write_failed", {
      userId: ctx.userId,
      id: accountId,
      error,
    });
    return { ok: false, error: "No se pudo guardar la clasificación." };
  }

  await logAudit(
    "management_bucket.set",
    ctx.userId,
    {
      from_bucket: before?.bucket ?? null,
      from_subbucket: before?.subbucket ?? null,
      bucket,
      subbucket,
    },
    accountId,
  );
  return { ok: true, data: { accountId } };
}

/** The documents behind one figure of the month table (a line, a month
 *  range, a side and a cost center), nominal. A document opens only for who
 *  can read its module. */
export async function getManagementDrillAction(
  input: unknown,
): Promise<ActionResult<ManagementDrill>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "management:read")) {
    return { ok: false, error: DENIED };
  }
  const parsed = ManagementDrillInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const v = parsed.data;
  // PostgREST answers at most max_rows (1000) per request: page by range,
  // up to DRILL_READ_LIMIT rows (then the figure is flagged partial).
  const raw: RawManagementDocument[] = [];
  let partial = false;
  for (let from = 0; ; from += DRILL_PAGE) {
    const { data, error } = await getServiceClient()
      .rpc("get_management_pnl_documents", {
        p_from: `${v.fromPeriod}-01`,
        p_to: endOfMonth(v.toPeriod),
        p_basis: v.basis,
        p_buckets: [...lineBuckets(v.lineKey)],
      })
      .range(from, from + DRILL_PAGE - 1);
    if (error) {
      logger.error("management.drill.failed", { userId: ctx.userId, error });
      return { ok: false, error: "No se pudo leer el detalle." };
    }
    raw.push(...(data ?? []));
    if ((data ?? []).length < DRILL_PAGE) break;
    if (raw.length >= DRILL_READ_LIMIT) {
      partial = true;
      break;
    }
  }
  const { docs, unknown } = narrowManagementDocuments(raw, (type) =>
    userCanAll(ctx.access, DOC_TYPE_PERMISSIONS[type]),
  );
  if (unknown.length > 0) {
    logger.error("management.drill.unknown_rows", {
      userId: ctx.userId,
      count: unknown.length,
    });
  }
  return { ok: true, data: { ...drillDocuments(docs, v), partial } };
}

/** Records that someone downloaded the month table (internal use: who took
 *  the figures out). The file is built in the browser from the screen. */
export async function logManagementExportAction(
  input: unknown,
): Promise<ActionResult<null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "management:read")) {
    return { ok: false, error: DENIED };
  }
  const parsed = ManagementExportInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  await logAudit("management.exported", ctx.userId, { ...parsed.data });
  return { ok: true, data: null };
}
