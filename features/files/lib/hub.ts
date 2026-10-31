import {
  ENTITY_READ_PERMISSION,
  ENTITY_TYPES,
  type EntityType,
} from "@/lib/auth/entity-permissions";
import { userCan, type Access } from "@/lib/auth/permissions";

// The /files hub: which owning entities a role may list, how a row links back
// to its entity, and the PostgREST filters the list action composes. The view
// (v_files_hub) is SECURITY INVOKER, so RLS applies underneath as well.

export const HUB_ENTITY_TYPES = ENTITY_TYPES;

export type HubEntityType = EntityType;

export const HUB_ENTITY_LABEL: Record<HubEntityType, string> = {
  purchase_invoice: "Factura de compra",
  invoice: "Comprobante emitido",
  receipt: "Recibo",
  payment_order: "Orden de pago",
  check: "Cheque de tercero",
  issued_check: "Cheque propio",
  client: "Cliente",
  supplier: "Proveedor",
  transaction: "Movimiento de caja",
  ai_document: "Documento escaneado",
  ai_chat_message: "Chat con IA",
  employee_document: "Documento de empleado",
  fleet_document: "Documento de flota",
};

/** Entities that belong to one user (owner_id): only ai:admin sees others'. */
const OWNER_SCOPED: ReadonlySet<HubEntityType> = new Set([
  "ai_document",
  "ai_chat_message",
]);

export type HubScope = {
  entityTypes: HubEntityType[];
  /** Restrict rows with an owner to the caller's own. */
  ownOnly: boolean;
};

export function hubScope(access: Access): HubScope {
  const entityTypes = HUB_ENTITY_TYPES.filter((t) =>
    userCan(access, ENTITY_READ_PERMISSION[t]),
  );
  const ownOnly =
    entityTypes.some((t) => OWNER_SCOPED.has(t)) &&
    !userCan(access, "ai:admin");
  return { entityTypes, ownOnly };
}

export const HUB_FILE_KINDS = ["pdf", "image", "spreadsheet"] as const;
export type HubFileKind = (typeof HUB_FILE_KINDS)[number];

export const HUB_FILE_KIND_LABEL: Record<HubFileKind, string> = {
  pdf: "PDF",
  image: "Imagen",
  spreadsheet: "Planilla",
};

export const SPREADSHEET_MIMES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type HubCursor = { uploadedAt: string; linkId: string };

/**
 * The single `or=` expression the list needs: the owner restriction and the
 * keyset cursor (uploaded_at desc, link_id desc). PostgREST takes one logic
 * tree per parameter, so both go in one `and(...)`. Null when neither applies.
 */
export function buildHubOrFilter(input: {
  ownerId: string | null;
  cursor: HubCursor | null;
}): string | null {
  const owner = input.ownerId
    ? `owner_id.is.null,owner_id.eq.${input.ownerId}`
    : null;
  const cursor = input.cursor
    ? `uploaded_at.lt."${input.cursor.uploadedAt}",and(uploaded_at.eq."${input.cursor.uploadedAt}",link_id.lt.${input.cursor.linkId})`
    : null;
  if (owner && cursor) return `and(or(${owner}),or(${cursor}))`;
  return owner ?? cursor;
}

/**
 * `ilike` pattern for a search, with the user's `%`, `_` and `\\` taken
 * literally. PostgREST turns `*` into `%`, so a `*` becomes `_`: one
 * character, which still matches a literal asterisk.
 */
export function containsPattern(search: string): string {
  const escaped = search
    .replace(/[\\%_]/g, (c) => `\\${c}`)
    .replace(/\*/g, "_");
  return `%${escaped}%`;
}

/** The day after an ISO date (for an exclusive upper bound). */
export function nextIsoDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Where a row's owning entity lives in the app. */
export function hubEntityHref(row: {
  entityType: HubEntityType;
  entityId: string;
  parentId: string | null;
}): string {
  switch (row.entityType) {
    case "purchase_invoice":
      return `/purchases/${row.entityId}`;
    case "invoice":
      return `/invoices/${row.entityId}`;
    case "receipt":
      return `/receipts/${row.entityId}`;
    case "payment_order":
      return `/payment-orders/${row.entityId}`;
    case "check":
      return "/checks";
    case "issued_check":
      return "/issued-checks";
    case "client":
      return `/clients/${row.entityId}`;
    case "supplier":
      return `/suppliers/${row.entityId}`;
    case "transaction":
      return "/transactions";
    case "ai_document":
      return "/documentos";
    case "ai_chat_message":
      return row.parentId ? `/ai?session=${row.parentId}` : "/ai";
    case "employee_document":
      return row.parentId ? `/employees/${row.parentId}` : "/employees";
    case "fleet_document":
      return "/fleet-documents";
  }
}

export function isHubEntityType(value: string | null): value is HubEntityType {
  return value !== null && HUB_ENTITY_TYPES.some((t) => t === value);
}
