import { userCan, type Permission, type Role } from "@/lib/auth/permissions";

// The /files hub: which owning entities a role may list, how a row links back
// to its entity, and the PostgREST filters the list action composes. The view
// (v_files_hub) is SECURITY INVOKER, so RLS applies underneath as well.

export const HUB_ENTITY_TYPES = [
  "purchase_invoice",
  "invoice",
  "receipt",
  "payment_order",
  "check",
  "issued_check",
  "client",
  "supplier",
  "transaction",
  "ai_document",
  "ai_chat_message",
  "employee_document",
] as const;

export type HubEntityType = (typeof HUB_ENTITY_TYPES)[number];

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
};

/** The read permission of the owning entity: a file is listed only to whom
 *  can see what it is attached to. */
export const HUB_ENTITY_PERMISSION: Record<HubEntityType, Permission> = {
  purchase_invoice: "purchase_invoices:read",
  invoice: "invoices:read",
  receipt: "receipts:read",
  payment_order: "payment_orders:read",
  check: "cheques:read",
  issued_check: "issued_checks:read",
  client: "clients:read",
  supplier: "suppliers:read",
  transaction: "transactions:read",
  ai_document: "ai:read",
  ai_chat_message: "ai:chat",
  employee_document: "hr:read",
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

export function hubScope(roles: readonly Role[]): HubScope {
  const entityTypes = HUB_ENTITY_TYPES.filter((t) =>
    userCan(roles, HUB_ENTITY_PERMISSION[t]),
  );
  const ownOnly =
    entityTypes.some((t) => OWNER_SCOPED.has(t)) && !userCan(roles, "ai:admin");
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

/** `ilike` pattern for a search, with the user's wildcards taken literally. */
export function containsPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
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
  }
}

export function isHubEntityType(value: string | null): value is HubEntityType {
  return value !== null && HUB_ENTITY_TYPES.some((t) => t === value);
}
