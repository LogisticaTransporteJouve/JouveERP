"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import {
  TREASURY_PERMISSIONS,
  userCan,
  userCanAll,
  type Permission,
} from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { todayInAR } from "@/lib/format";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  DashboardLayoutSchema,
  type DashboardLayout,
  type DueDateItem,
  type OpsKpis,
} from "../schema";

const HORIZON_DAYS = 14;

const SECTION_PERMISSIONS: Permission[] = [
  "cheques:read",
  "issued_checks:read",
  "accounts:read",
  "recurring_payments:read",
  "fleet_documents:read",
  "hr:read",
];

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Unified 14-day agenda: checks maturing (both directions), loan
// installments, recurring payments and document expiries. Each section is
// included only if the caller has that section's read permission, so the
// same action serves finance and operations roles with different content.
export async function getDashboardDueDatesAction(): Promise<
  ActionResult<DueDateItem[]>
> {
  const ctx = await requireUserContext();
  if (!SECTION_PERMISSIONS.some((p) => userCan(ctx.access, p))) {
    return { ok: false, error: "No tenés permiso." };
  }

  const supabase = await createSupabaseClient();
  const today = todayInAR();
  const until = addDaysIso(today, HORIZON_DAYS);
  // The six sections are independent reads → run them in parallel. Each
  // returns [] when the caller lacks its permission; the concatenation keeps
  // the original section order so the (stable) date sort is unchanged.
  const sections = await Promise.all([
    (async (): Promise<DueDateItem[]> => {
      if (!userCan(ctx.access, "cheques:read")) return [];
      const out: DueDateItem[] = [];
      const { data, error } = await supabase
        .from("checks")
        .select("id, check_number, bank_name, amount, currency, due_date")
        .eq("status", "en_cartera")
        .gte("due_date", today)
        .lte("due_date", until);
      if (error) {
        logger.warn("dashboard.due_dates.checks_failed", {
          userId: ctx.userId,
          error,
        });
      }
      for (const c of data ?? []) {
        out.push({
          id: `received_check:${c.id}`,
          kind: "received_check",
          date: c.due_date,
          label: `Cheque en cartera ${c.check_number}`,
          detail: c.bank_name,
          amount: Number(c.amount),
          currency: c.currency === "USD" ? "USD" : "ARS",
          direction: "in",
          href: "/checks",
        });
      }
      return out;
    })(),
    (async (): Promise<DueDateItem[]> => {
      if (!userCan(ctx.access, "issued_checks:read")) return [];
      const out: DueDateItem[] = [];
      const { data, error } = await supabase
        .from("issued_checks")
        .select(
          "id, check_number, beneficiary_name, amount, currency, due_date",
        )
        .eq("status", "emitted")
        .gte("due_date", today)
        .lte("due_date", until);
      if (error) {
        logger.warn("dashboard.due_dates.issued_checks_failed", {
          userId: ctx.userId,
          error,
        });
      }
      for (const c of data ?? []) {
        out.push({
          id: `issued_check:${c.id}`,
          kind: "issued_check",
          date: c.due_date,
          label: `Cheque propio ${c.check_number}`,
          detail: c.beneficiary_name,
          amount: Number(c.amount),
          currency: c.currency === "USD" ? "USD" : "ARS",
          direction: "out",
          href: "/issued-checks",
        });
      }
      return out;
    })(),
    (async (): Promise<DueDateItem[]> => {
      if (!userCanAll(ctx.access, TREASURY_PERMISSIONS)) return [];
      const out: DueDateItem[] = [];
      const { data, error } = await supabase
        .from("loan_installments")
        .select(
          "id, number, amount, due_date, loan:loans!inner(description, lender, currency, status)",
        )
        .eq("status", "pendiente")
        .eq("loan.status", "active")
        .gte("due_date", today)
        .lte("due_date", until);
      if (error) {
        logger.warn("dashboard.due_dates.loans_failed", {
          userId: ctx.userId,
          error,
        });
      }
      for (const i of data ?? []) {
        const loan = Array.isArray(i.loan) ? i.loan[0] : i.loan;
        if (!loan) continue;
        out.push({
          id: `loan_installment:${i.id}`,
          kind: "loan_installment",
          date: i.due_date,
          label: `Cuota ${i.number} · ${loan.description}`,
          detail: loan.lender,
          amount: Number(i.amount),
          currency: loan.currency === "USD" ? "USD" : "ARS",
          direction: "out",
          href: "/loans",
        });
      }
      return out;
    })(),
    (async (): Promise<DueDateItem[]> => {
      if (!userCan(ctx.access, "recurring_payments:read")) return [];
      const out: DueDateItem[] = [];
      const { data, error } = await supabase
        .from("recurring_payments")
        .select("id, description, category, amount, currency, next_due_date")
        .eq("is_active", true)
        .gte("next_due_date", today)
        .lte("next_due_date", until);
      if (error) {
        logger.warn("dashboard.due_dates.recurring_failed", {
          userId: ctx.userId,
          error,
        });
      }
      for (const r of data ?? []) {
        out.push({
          id: `recurring_payment:${r.id}`,
          kind: "recurring_payment",
          date: r.next_due_date,
          label: r.description,
          detail: r.category,
          amount: Number(r.amount),
          currency: r.currency === "USD" ? "USD" : "ARS",
          direction: "out",
          href: "/recurring-payments",
        });
      }
      return out;
    })(),
    (async (): Promise<DueDateItem[]> => {
      if (!userCan(ctx.access, "fleet_documents:read")) return [];
      const out: DueDateItem[] = [];
      const { data, error } = await supabase
        .from("fleet_documents")
        .select(
          "id, kind, expires_at, vehicle:vehicles(patente), driver:drivers(full_name)",
        )
        .gte("expires_at", today)
        .lte("expires_at", until);
      if (error) {
        logger.warn("dashboard.due_dates.fleet_docs_failed", {
          userId: ctx.userId,
          error,
        });
      }
      for (const d of data ?? []) {
        const vehicle = Array.isArray(d.vehicle) ? d.vehicle[0] : d.vehicle;
        const driver = Array.isArray(d.driver) ? d.driver[0] : d.driver;
        out.push({
          id: `fleet_document:${d.id}`,
          kind: "fleet_document",
          date: d.expires_at,
          label: `Vence ${d.kind}`,
          detail: vehicle?.patente ?? driver?.full_name ?? null,
          amount: null,
          currency: null,
          direction: null,
          href: "/fleet-documents",
        });
      }
      return out;
    })(),
    (async (): Promise<DueDateItem[]> => {
      if (!userCan(ctx.access, "hr:read")) return [];
      const out: DueDateItem[] = [];
      const { data, error } = await supabase
        .from("v_documents_expiring")
        .select("id, kind, expires_at, employee_name, days_until_expiry")
        .gte("days_until_expiry", 0)
        .lte("days_until_expiry", HORIZON_DAYS);
      if (error) {
        logger.warn("dashboard.due_dates.employee_docs_failed", {
          userId: ctx.userId,
          error,
        });
      }
      for (const d of data ?? []) {
        if (!d.id || !d.expires_at) continue;
        out.push({
          id: `employee_document:${d.id}`,
          kind: "employee_document",
          date: d.expires_at,
          label: `Vence ${d.kind}`,
          detail: d.employee_name,
          amount: null,
          currency: null,
          direction: null,
          href: "/hr/document-expirations",
        });
      }
      return out;
    })(),
  ]);
  const items = sections.flat();

  items.sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, data: items };
}

// Operational counters for the landing page. Each counter is null when the
// caller lacks that section's read permission, so the component can hide it.
export async function getDashboardOpsAction(): Promise<ActionResult<OpsKpis>> {
  const ctx = await requireUserContext();
  const canTrips = userCan(ctx.access, "trips:read");
  const canShipments = userCan(ctx.access, "shipments:read");
  const canPallets = userCan(ctx.access, "pallets:read");
  if (!canTrips && !canShipments && !canPallets) {
    return { ok: false, error: "No tenés permiso." };
  }

  const supabase = await createSupabaseClient();

  const [trips, shipments, pallets] = await Promise.all([
    canTrips
      ? supabase
          .from("trips")
          .select("id", { count: "exact", head: true })
          .eq("status", "in_progress")
      : null,
    canShipments
      ? supabase
          .from("shipments")
          .select("id", { count: "exact", head: true })
          .in("status", ["not_started", "in_progress"])
      : null,
    canPallets
      ? supabase
          .from("pallets")
          .select("id", { count: "exact", head: true })
          .eq("status", "en_deposito")
      : null,
  ]);

  for (const [label, res] of [
    ["trips", trips],
    ["shipments", shipments],
    ["pallets", pallets],
  ] as const) {
    if (res?.error) {
      logger.warn("dashboard.ops.count_failed", {
        userId: ctx.userId,
        section: label,
        error: res.error,
      });
    }
  }

  return {
    ok: true,
    data: {
      trips_in_progress: trips && !trips.error ? (trips.count ?? 0) : null,
      shipments_pending:
        shipments && !shipments.error ? (shipments.count ?? 0) : null,
      pallets_stored: pallets && !pallets.error ? (pallets.count ?? 0) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Personal layout (dashboard_layouts) — personal preference, no permission
// gate beyond an authenticated session; RLS restricts each row to its owner.
// ---------------------------------------------------------------------------

export async function getMyDashboardLayoutAction(): Promise<
  ActionResult<DashboardLayout | null>
> {
  const ctx = await requireUserContext();
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("dashboard_layouts")
    .select("layout")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) {
    logger.error("dashboard.layout.read_failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo leer el layout." };
  }
  if (!data) return { ok: true, data: null };
  const parsed = DashboardLayoutSchema.safeParse(data.layout);
  // A stale layout (e.g. a widget id removed in a newer version) falls back
  // to the role template instead of erroring.
  return { ok: true, data: parsed.success ? parsed.data : null };
}

export async function saveMyDashboardLayoutAction(
  input: unknown,
): Promise<ActionResult<void>> {
  const ctx = await requireUserContext();
  const parsed = DashboardLayoutSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Layout inválido.",
    };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("dashboard_layouts").upsert({
    user_id: ctx.userId,
    layout: parsed.data,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    logger.error("dashboard.layout.save_failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo guardar el layout." };
  }
  return { ok: true, data: undefined };
}

export async function resetMyDashboardLayoutAction(): Promise<
  ActionResult<void>
> {
  const ctx = await requireUserContext();
  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("dashboard_layouts")
    .delete()
    .eq("user_id", ctx.userId);
  if (error) {
    logger.error("dashboard.layout.reset_failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo restablecer el layout." };
  }
  return { ok: true, data: undefined };
}
