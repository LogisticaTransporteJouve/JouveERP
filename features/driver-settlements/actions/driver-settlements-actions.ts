"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { round2 } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { formatReceiptNumber } from "@/features/receipts/schema";

import {
  DriverSettlementIdSchema,
  DriverSettlementSaveSchema,
  groupPendingByDriver,
  isDriverSettlementStatus,
  settlementDifference,
  type CodPending,
  type CodPendingShipment,
  type DriverSettlement,
  type DriverSettlementDetail,
  type DriverSettlementItem,
  type DriverSettlementSaveInput,
  type SettlementAccount,
} from "../schema";

const READ_DENIED = "No tenés permiso para ver rendiciones.";
const WRITE_DENIED = "No tenés permiso para registrar rendiciones.";

// Rendiciones are treasury: read with receipts:read, posted with
// receipts:write (they create receipts). Cargas are read through the service
// client after the gate, as storage billing reads pallets.

const SETTLEMENT_COLUMNS =
  "id, numero, driver_id, settlement_date, status, notes, created_at, driver:drivers(full_name)";

const ITEM_COLUMNS =
  "id, settlement_id, shipment_id, expected_amount, note, released, lines:driver_settlement_lines(id, account_id, amount, reference, check_number, bank_name, drawer_name, check_due_date, receipt_id, account:accounts(name, type), receipt:receipts(punto_venta, numero, status))";

type SettlementRow = {
  id: string;
  numero: number | null;
  driver_id: string;
  settlement_date: string;
  status: string;
  notes: string | null;
  created_at: string;
  driver: { full_name: string } | null;
};

type ItemRow = {
  id: string;
  settlement_id: string;
  shipment_id: string;
  expected_amount: number;
  note: string | null;
  released: boolean;
  lines: {
    id: string;
    account_id: string;
    amount: number;
    reference: string | null;
    check_number: string | null;
    bank_name: string | null;
    drawer_name: string | null;
    check_due_date: string | null;
    receipt_id: string | null;
    account: { name: string; type: string } | null;
    receipt: { punto_venta: number; numero: number; status: string } | null;
  }[];
};

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

/** The rendición's totals and receipts from its items. A cancelled one keeps
 *  its (released) items for the record. */
function summarize(
  row: SettlementRow,
  items: readonly ItemRow[],
): DriverSettlement | null {
  if (!isDriverSettlementStatus(row.status)) {
    logger.error("driver_settlements.unknown_status", {
      id: row.id,
      status: row.status,
    });
    return null;
  }
  let expected = 0;
  let received = 0;
  const receipts = new Map<
    string,
    { id: string; label: string; canceled: boolean }
  >();
  for (const item of items) {
    expected += Number(item.expected_amount);
    for (const line of item.lines) {
      received += Number(line.amount);
      if (line.receipt_id && line.receipt) {
        receipts.set(line.receipt_id, {
          id: line.receipt_id,
          label: formatReceiptNumber(
            line.receipt.punto_venta,
            line.receipt.numero,
          ),
          canceled: line.receipt.status === "canceled",
        });
      }
    }
  }
  return {
    id: row.id,
    numero: row.numero,
    driver_id: row.driver_id,
    driver_name: row.driver?.full_name ?? "—",
    settlement_date: row.settlement_date,
    status: row.status,
    notes: row.notes,
    expected_total: round2(expected),
    received_total: round2(received),
    difference: settlementDifference(expected, received),
    cargas: items.length,
    receipts: [...receipts.values()],
    created_at: row.created_at,
  };
}

/** Every rendición, newest first, with its totals and receipts. */
export async function listDriverSettlementsAction(): Promise<
  ActionResult<DriverSettlement[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "receipts:read")) {
    return { ok: false, error: READ_DENIED };
  }
  const supabase = getServiceClient();
  const [heads, items] = await Promise.all([
    paginateRange<SettlementRow>((from, to) =>
      supabase
        .from("driver_settlements")
        .select(SETTLEMENT_COLUMNS)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    paginateRange<ItemRow>((from, to) =>
      supabase
        .from("driver_settlement_items")
        .select(ITEM_COLUMNS)
        .order("id")
        .range(from, to),
    ),
  ]);
  if (heads.error || items.error) {
    logger.error("driver_settlements.list.failed", {
      userId: ctx.userId,
      error: heads.error ?? items.error,
    });
    return { ok: false, error: "No se pudieron listar las rendiciones." };
  }
  const bySettlement = new Map<string, ItemRow[]>();
  for (const item of items.data) {
    const list = bySettlement.get(item.settlement_id) ?? [];
    list.push(item);
    bySettlement.set(item.settlement_id, list);
  }
  return {
    ok: true,
    data: heads.data
      .map((h) => summarize(h, bySettlement.get(h.id) ?? []))
      .filter((s): s is DriverSettlement => s !== null),
  };
}

export async function getDriverSettlementAction(
  id: string,
): Promise<ActionResult<DriverSettlementDetail>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "receipts:read")) {
    return { ok: false, error: READ_DENIED };
  }
  const parsed = DriverSettlementIdSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, error: "Rendición inválida." };

  const supabase = getServiceClient();
  const [head, items] = await Promise.all([
    supabase
      .from("driver_settlements")
      .select(SETTLEMENT_COLUMNS)
      .eq("id", parsed.data.id)
      .maybeSingle(),
    supabase
      .from("driver_settlement_items")
      .select(
        `${ITEM_COLUMNS}, shipment:shipments(remito_number, delivery_date, origin, destination, client:clients(legal_name))`,
      )
      .eq("settlement_id", parsed.data.id)
      .order("created_at")
      .order("id"),
  ]);
  if (head.error || items.error) {
    logger.error("driver_settlements.detail.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error: head.error ?? items.error,
    });
    return { ok: false, error: "No se pudo cargar la rendición." };
  }
  if (!head.data) return { ok: false, error: "No se encontró la rendición." };
  const rows = items.data ?? [];
  const summary = summarize(head.data, rows);
  if (!summary) return { ok: false, error: "No se pudo cargar la rendición." };

  const detailItems: DriverSettlementItem[] = rows.map((i) => ({
    id: i.id,
    shipment_id: i.shipment_id,
    remito_number: i.shipment?.remito_number ?? null,
    client_name: i.shipment?.client?.legal_name ?? "—",
    delivery_date: i.shipment?.delivery_date ?? null,
    origin: i.shipment?.origin ?? null,
    destination: i.shipment?.destination ?? null,
    expected_amount: Number(i.expected_amount),
    note: i.note,
    lines: i.lines.map((l) => ({
      id: l.id,
      account_id: l.account_id,
      account_name: l.account?.name ?? "—",
      account_type: l.account?.type ?? "",
      amount: Number(l.amount),
      reference: l.reference,
      check_number: l.check_number,
      bank_name: l.bank_name,
      drawer_name: l.drawer_name,
      check_due_date: l.check_due_date,
    })),
  }));
  return { ok: true, data: { ...summary, items: detailItems } };
}

/**
 * Delivered cash-on-delivery cargas that are in no live rendición, with
 * their driver (the trip's), and the same grouped per driver with the draft
 * rendiciones each one has.
 */
export async function listCodPendingAction(): Promise<
  ActionResult<CodPending>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "receipts:read")) {
    return { ok: false, error: READ_DENIED };
  }
  const supabase = getServiceClient();
  const [ships, live, drafts] = await Promise.all([
    paginateRange((from, to) =>
      supabase
        .from("shipments")
        .select(
          "id, remito_number, delivery_date, origin, destination, cod_amount, client:clients(legal_name), trip:trips(driver_id, driver:drivers(full_name))",
        )
        .not("cod_amount", "is", null)
        .eq("status", "delivered")
        .order("delivery_date", { ascending: true, nullsFirst: false })
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("driver_settlement_items")
        .select("shipment_id")
        .eq("released", false)
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("driver_settlements")
        .select("driver_id, driver:drivers(full_name)")
        .eq("status", "draft")
        .order("id")
        .range(from, to),
    ),
  ]);
  if (ships.error || live.error || drafts.error) {
    logger.error("driver_settlements.pending.failed", {
      userId: ctx.userId,
      error: ships.error ?? live.error ?? drafts.error,
    });
    return {
      ok: false,
      error: "No se pudieron cargar las cobranzas pendientes.",
    };
  }
  const taken = new Set(live.data.map((l) => l.shipment_id));
  const shipments: CodPendingShipment[] = ships.data
    .filter((s) => !taken.has(s.id) && s.cod_amount !== null)
    .map((s) => ({
      shipment_id: s.id,
      driver_id: s.trip?.driver_id ?? null,
      driver_name: s.trip?.driver?.full_name ?? null,
      remito_number: s.remito_number,
      client_name: s.client?.legal_name ?? "Sin cliente",
      delivery_date: s.delivery_date,
      origin: s.origin,
      destination: s.destination,
      cod_amount: Number(s.cod_amount),
    }));
  const byDriver = groupPendingByDriver(
    shipments,
    drafts.data.map((d) => ({
      driver_id: d.driver_id,
      driver_name: d.driver?.full_name ?? "—",
    })),
  );
  return { ok: true, data: { shipments, byDriver } };
}

/** Active ARS accounts a rendición posts to (caja, banco, cheques). */
export async function listDriverSettlementAccountsAction(): Promise<
  ActionResult<SettlementAccount[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "receipts:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, type")
    .eq("is_active", true)
    .eq("currency", "ARS")
    .order("name")
    .order("id");
  if (error) {
    logger.error("driver_settlements.accounts.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron cargar las cuentas." };
  }
  return { ok: true, data: data ?? [] };
}

/** Creates a draft or replaces a draft's date, notes, cargas and lines. */
export async function saveDriverSettlementAction(
  input: DriverSettlementSaveInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "receipts:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = DriverSettlementSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;

  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("save_driver_settlement", {
    p_driver_id: d.driver_id,
    p_settlement_date: d.settlement_date,
    p_notes: d.notes ?? "",
    p_items: d.items.map((item) => ({
      shipment_id: item.shipment_id,
      note: item.note ?? null,
      lines: item.lines.map((l) => ({
        account_id: l.account_id,
        amount: l.amount,
        reference: l.reference ?? null,
        check_number: l.check_number ?? null,
        bank_name: l.bank_name ?? null,
        drawer_name: l.drawer_name ?? null,
        drawer_cuit: l.drawer_cuit ?? null,
        check_issue_date: l.check_issue_date ?? null,
        check_due_date: l.check_due_date ?? null,
      })),
    })),
    p_user_id: ctx.userId,
    ...(d.id ? { p_settlement_id: d.id } : {}),
  });
  if (error || !data) {
    const guardError = mapDbGuardError(error, {
      slug: "driver_settlements.save.rejected",
      userId: ctx.userId,
      id: d.id ?? null,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("driver_settlements.save.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudo guardar la rendición." };
  }

  const received = round2(
    d.items.reduce((s, i) => s + i.lines.reduce((t, l) => t + l.amount, 0), 0),
  );
  await logAudit(
    d.id ? "driver_settlement.updated" : "driver_settlement.created",
    ctx.userId,
    {
      driver_id: d.driver_id,
      settlement_date: d.settlement_date,
      cargas: d.items.length,
      received,
    },
    data,
  );
  return { ok: true, data: { id: data } };
}

/** Posts the rendición as receipts (one per client and channel). Confirming
 *  twice returns the same receipts. */
export async function confirmDriverSettlementAction(input: {
  id: string;
}): Promise<ActionResult<{ receiptIds: string[] }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "receipts:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = DriverSettlementIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Rendición inválida." };

  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("confirm_driver_settlement", {
    p_settlement_id: parsed.data.id,
    p_user_id: ctx.userId,
  });
  if (error || !data) {
    const guardError = mapDbGuardError(error, {
      slug: "driver_settlements.confirm.rejected",
      userId: ctx.userId,
      id: parsed.data.id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("driver_settlements.confirm.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo confirmar la rendición." };
  }

  await logAudit(
    "driver_settlement.confirmed",
    ctx.userId,
    { receipt_ids: data },
    parsed.data.id,
  );
  return { ok: true, data: { receiptIds: data } };
}

/** Cancels the rendición and puts its cargas back as pending. A confirmed
 *  one needs its receipts cancelled first. */
export async function cancelDriverSettlementAction(input: {
  id: string;
}): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "receipts:write")) {
    return { ok: false, error: WRITE_DENIED };
  }
  const parsed = DriverSettlementIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Rendición inválida." };

  const supabase = getServiceClient();
  const { error } = await supabase.rpc("cancel_driver_settlement", {
    p_settlement_id: parsed.data.id,
    p_user_id: ctx.userId,
  });
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "driver_settlements.cancel.rejected",
      userId: ctx.userId,
      id: parsed.data.id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("driver_settlements.cancel.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo cancelar la rendición." };
  }

  await logAudit("driver_settlement.cancelled", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
