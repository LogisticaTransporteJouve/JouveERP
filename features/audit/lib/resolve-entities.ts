import "server-only";

import type { JsonValue } from "@/lib/actions/audit";
import { getServiceClient } from "@/lib/supabase/service";

import {
  ENTITY_HREF,
  PAYLOAD_REFS,
  PAYLOAD_USER_LISTS,
  entityKey,
  isUuid,
  type AuditEntity,
  type EntityKind,
  type EntityLookup,
} from "./entities";
import { auditSubjectKind } from "./registry";
import {
  documentNumber,
  invoiceNoun,
  money,
  purchaseNoun,
  shortDate,
} from "./words";

type Db = ReturnType<typeof getServiceClient>;

/** What an event needs resolved: its target and the ids in its payload. */
export type ResolvableEvent = {
  event_type: string;
  target_resource_id: string | null;
  target_user_id: string | null;
  payload: JsonValue;
};

type Wanted = Map<EntityKind, Set<string>>;

function want(wanted: Wanted, kind: EntityKind, id: unknown) {
  if (!isUuid(id)) return;
  const set = wanted.get(kind) ?? new Set<string>();
  set.add(id);
  wanted.set(kind, set);
}

/** Every record the events name, by kind, deduplicated. */
export function collectEntityIds(events: readonly ResolvableEvent[]): Wanted {
  const wanted: Wanted = new Map();
  for (const e of events) {
    const kind = auditSubjectKind(e.event_type);
    if (kind) want(wanted, kind, e.target_resource_id);
    want(wanted, "user", e.target_user_id);
    const p = e.payload;
    if (typeof p !== "object" || p === null || Array.isArray(p)) continue;
    for (const [key, value] of Object.entries(p)) {
      const refKind = PAYLOAD_REFS[key];
      if (refKind) want(wanted, refKind, value);
    }
    for (const key of PAYLOAD_USER_LISTS) {
      const list = p[key];
      if (Array.isArray(list)) for (const id of list) want(wanted, "user", id);
    }
    for (const key of ["employee_ids", "check_ids"] as const) {
      const list = p[key];
      const kind2: EntityKind = key === "employee_ids" ? "employee" : "check";
      if (Array.isArray(list)) for (const id of list) want(wanted, kind2, id);
    }
  }
  return wanted;
}

/** A fetched row: its own words, plus the records it needs named first
 *  (a document's client or supplier, a trip's truck). */
type Fetched = {
  id: string;
  needs: [EntityKind, string | null][];
  build: (get: (kind: EntityKind, id: string | null) => AuditEntity | null) => {
    label: string;
    party?: string | null;
    amount?: string | null;
  };
};

type Fetcher = (db: Db, ids: string[]) => Promise<Fetched[]>;

function must<T>(res: { data: T[] | null; error: unknown }): T[] {
  if (res.error) throw res.error;
  return res.data ?? [];
}

const plain =
  (label: (get: Parameters<Fetched["build"]>[0]) => string) =>
  (get: Parameters<Fetched["build"]>[0]) => ({ label: label(get) });

const FETCHERS: Record<EntityKind, Fetcher> = {
  invoice: async (db, ids) =>
    must(
      await db
        .from("invoices")
        .select(
          "id, kind, letter, punto_venta, numero, client_id, imp_total, moneda",
        )
        .in("id", ids),
    ).map((r) => ({
      id: r.id,
      needs: [["client", r.client_id]],
      build: (get) => ({
        label: `la ${invoiceNoun(r.kind, r.letter)} ${documentNumber(r.punto_venta, r.numero, 4)}`,
        party: get("client", r.client_id)?.label ?? null,
        amount: money(r.imp_total, r.moneda),
      }),
    })),
  receipt: async (db, ids) =>
    must(
      await db
        .from("receipts")
        .select("id, punto_venta, numero, client_id, total_amount, currency")
        .in("id", ids),
    ).map((r) => ({
      id: r.id,
      needs: [["client", r.client_id]],
      build: (get) => ({
        label: `el Recibo ${documentNumber(r.punto_venta, r.numero, 4)}`,
        party: get("client", r.client_id)?.label ?? null,
        amount: money(r.total_amount, r.currency),
      }),
    })),
  payment_order: async (db, ids) =>
    must(
      await db
        .from("payment_orders")
        .select("id, punto_venta, numero, supplier_id, total_amount, currency")
        .in("id", ids),
    ).map((r) => ({
      id: r.id,
      needs: [["supplier", r.supplier_id]],
      build: (get) => ({
        label: `la Orden de pago ${documentNumber(r.punto_venta, r.numero, 4)}`,
        party: get("supplier", r.supplier_id)?.label ?? null,
        amount: money(r.total_amount, r.currency),
      }),
    })),
  purchase_invoice: async (db, ids) =>
    must(
      await db
        .from("purchase_invoices")
        .select(
          "id, kind, letter, punto_venta, numero, supplier_id, imp_total, moneda",
        )
        .in("id", ids),
    ).map((r) => ({
      id: r.id,
      needs: [["supplier", r.supplier_id]],
      build: (get) => ({
        label: `la ${purchaseNoun(r.kind, r.letter)} ${documentNumber(r.punto_venta, r.numero, 5)}`,
        party: get("supplier", r.supplier_id)?.label ?? null,
        amount: money(r.imp_total, r.moneda),
      }),
    })),
  trip: async (db, ids) =>
    must(
      await db
        .from("trips")
        .select("id, trip_date, vehicle_id, driver_id")
        .in("id", ids),
    ).map((r) => ({
      id: r.id,
      needs: [
        ["vehicle", r.vehicle_id],
        ["driver", r.driver_id],
      ],
      build: (get) => {
        const truck = get("vehicle", r.vehicle_id)?.label;
        const driver = get("driver", r.driver_id)?.label;
        const who = [truck, driver].filter(Boolean).join(" y ");
        return {
          label: `el viaje del ${shortDate(r.trip_date)}${who ? ` con ${who}` : ""}`,
        };
      },
    })),
  shipment: async (db, ids) =>
    must(
      await db
        .from("shipments")
        .select("id, remito_number, client_id, scheduled_date")
        .in("id", ids),
    ).map((r) => ({
      id: r.id,
      needs: [["client", r.client_id]],
      build: (get) => ({
        label: r.remito_number
          ? `la carga del remito ${r.remito_number}`
          : `la carga${r.scheduled_date ? ` del ${shortDate(r.scheduled_date)}` : ""}`,
        party: get("client", r.client_id)?.label ?? null,
      }),
    })),
  client: async (db, ids) =>
    must(await db.from("clients").select("id, legal_name").in("id", ids)).map(
      (r) => ({ id: r.id, needs: [], build: plain(() => r.legal_name) }),
    ),
  supplier: async (db, ids) =>
    must(await db.from("suppliers").select("id, legal_name").in("id", ids)).map(
      (r) => ({ id: r.id, needs: [], build: plain(() => r.legal_name) }),
    ),
  vehicle: async (db, ids) =>
    must(await db.from("vehicles").select("id, patente").in("id", ids)).map(
      (r) => ({ id: r.id, needs: [], build: plain(() => r.patente) }),
    ),
  driver: async (db, ids) =>
    must(await db.from("drivers").select("id, full_name").in("id", ids)).map(
      (r) => ({ id: r.id, needs: [], build: plain(() => r.full_name) }),
    ),
  employee: async (db, ids) =>
    must(await db.from("employees").select("id, legal_name").in("id", ids)).map(
      (r) => ({ id: r.id, needs: [], build: plain(() => r.legal_name) }),
    ),
  account: async (db, ids) =>
    must(await db.from("accounts").select("id, name").in("id", ids)).map(
      (r) => ({ id: r.id, needs: [], build: plain(() => r.name) }),
    ),
  user: async (db, ids) =>
    must(
      await db
        .from("user_profiles")
        .select("user_id, first_name, last_name")
        .in("user_id", ids),
    ).map((r) => ({
      id: r.user_id,
      needs: [],
      build: plain(
        () =>
          `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "un usuario",
      ),
    })),
  freight_settlement: async (db, ids) =>
    must(
      await db
        .from("freight_settlements")
        .select("id, client_id, period_start, period_end, total")
        .in("id", ids),
    ).map((r) => ({
      id: r.id,
      needs: [["client", r.client_id]],
      build: (get) => ({
        label: `la liquidación de flete del ${shortDate(r.period_start)} al ${shortDate(r.period_end)}`,
        party: get("client", r.client_id)?.label ?? null,
        amount: money(r.total),
      }),
    })),
  driver_settlement: async (db, ids) =>
    must(
      await db
        .from("driver_settlements")
        .select("id, driver_id, settlement_date")
        .in("id", ids),
    ).map((r) => ({
      id: r.id,
      needs: [["driver", r.driver_id]],
      build: (get) => ({
        label: `la rendición del ${shortDate(r.settlement_date)}`,
        party: get("driver", r.driver_id)?.label ?? null,
      }),
    })),
  tax_document: async (db, ids) =>
    must(
      await db
        .from("tax_documents")
        .select("id, kind, title, period")
        .in("id", ids),
    ).map((r) => ({
      id: r.id,
      needs: [],
      build: plain(() => `el impuesto ${r.title ?? r.kind} de ${r.period}`),
    })),
  loan: async (db, ids) =>
    must(await db.from("loans").select("id, description").in("id", ids)).map(
      (r) => ({
        id: r.id,
        needs: [],
        build: plain(() => `el préstamo «${r.description}»`),
      }),
    ),
  task: async (db, ids) =>
    must(await db.from("tasks").select("id, title").in("id", ids)).map((r) => ({
      id: r.id,
      needs: [],
      build: plain(() => `la tarea «${r.title}»`),
    })),
  check: async (db, ids) =>
    must(
      await db
        .from("checks")
        .select("id, check_number, bank_name, amount, currency")
        .in("id", ids),
    ).map((r) => ({
      id: r.id,
      needs: [],
      build: () => ({
        label: `el cheque N° ${r.check_number} del ${r.bank_name}`,
        amount: money(r.amount, r.currency),
      }),
    })),
  issued_check: async (db, ids) =>
    must(
      await db
        .from("issued_checks")
        .select("id, check_number, beneficiary_name, amount, currency")
        .in("id", ids),
    ).map((r) => ({
      id: r.id,
      needs: [],
      build: () => ({
        label: `el cheque propio N° ${r.check_number}`,
        party: r.beneficiary_name,
        amount: money(r.amount, r.currency),
      }),
    })),
  product: async (db, ids) =>
    must(await db.from("products").select("id, name").in("id", ids)).map(
      (r) => ({
        id: r.id,
        needs: [],
        build: plain(() => `el producto «${r.name}»`),
      }),
    ),
  warehouse: async (db, ids) =>
    must(await db.from("warehouses").select("id, name").in("id", ids)).map(
      (r) => ({
        id: r.id,
        needs: [],
        build: plain(() => `el depósito «${r.name}»`),
      }),
    ),
  cost_center: async (db, ids) =>
    must(await db.from("cost_centers").select("id, name").in("id", ids)).map(
      (r) => ({
        id: r.id,
        needs: [],
        build: plain(() => `el centro de costo «${r.name}»`),
      }),
    ),
  recurring_payment: async (db, ids) =>
    must(
      await db
        .from("recurring_payments")
        .select("id, description")
        .in("id", ids),
    ).map((r) => ({
      id: r.id,
      needs: [],
      build: plain(() => `el pago recurrente «${r.description}»`),
    })),
};

async function fetchAll(db: Db, wanted: Wanted): Promise<Fetched[][]> {
  return Promise.all(
    [...wanted].map(([kind, ids]) =>
      FETCHERS[kind](db, [...ids]).then((rows) =>
        rows.map((row) => ({ ...row, kind })),
      ),
    ),
  );
}

/**
 * Names and links every record the events mention: one query per kind of
 * record, plus one more round for the clients, suppliers, trucks and drivers
 * those records point to. Records that no longer exist are left out; the
 * sentences fall back to a generic noun for them.
 */
export async function resolveAuditEntities(
  events: readonly ResolvableEvent[],
): Promise<EntityLookup> {
  const db = getServiceClient();
  const wanted = collectEntityIds(events);
  const first = (await fetchAll(db, wanted)).flat();

  const second: Wanted = new Map();
  for (const row of first) {
    for (const [kind, id] of row.needs) {
      if (id && !wanted.get(kind)?.has(id)) want(second, kind, id);
    }
  }
  const rows: (Fetched & { kind?: EntityKind })[] = [
    ...first,
    ...(await fetchAll(db, second)).flat(),
  ];

  const out = new Map<string, AuditEntity>();
  const byKey = new Map<string, Fetched & { kind?: EntityKind }>();
  for (const row of rows) {
    if (row.kind) byKey.set(entityKey(row.kind, row.id), row);
  }
  const get = (kind: EntityKind, id: string | null): AuditEntity | null => {
    if (!id) return null;
    const key = entityKey(kind, id);
    const done = out.get(key);
    if (done) return done;
    const row = byKey.get(key);
    if (!row) return null;
    const built = row.build(get);
    const href = ENTITY_HREF[kind];
    const entity: AuditEntity = {
      kind,
      id,
      label: built.label,
      party: built.party ?? null,
      amount: built.amount ?? null,
      href: href ? href(id) : null,
    };
    out.set(key, entity);
    return entity;
  };
  for (const row of rows) if (row.kind) get(row.kind, row.id);
  return out;
}
