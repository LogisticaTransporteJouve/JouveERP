// The records an audit event can be about, as the screen names and links
// them. Resolved in batch on the server (resolve-entities.ts); the sentence
// registry only reads them.

export const ENTITY_KINDS = [
  "invoice",
  "receipt",
  "payment_order",
  "purchase_invoice",
  "trip",
  "shipment",
  "client",
  "supplier",
  "vehicle",
  "driver",
  "employee",
  "account",
  "user",
  "freight_settlement",
  "driver_settlement",
  "tax_document",
  "loan",
  "task",
  "check",
  "issued_check",
  "product",
  "warehouse",
  "cost_center",
  "recurring_payment",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** A resolved record: how a sentence names it and where it lives. */
export type AuditEntity = {
  kind: EntityKind;
  id: string;
  /** "la Factura A 0003-00022312", "TRANSPORTES SUR SA", "AE463UF". */
  label: string;
  /** The client or supplier of a document, when it has one. */
  party: string | null;
  /** "$ 1.234.567,00" for a document with a total. */
  amount: string | null;
  href: string | null;
};

export type EntityLookup = ReadonlyMap<string, AuditEntity>;

export function entityKey(kind: EntityKind, id: string): string {
  return `${kind}:${id}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Where each kind's record lives: its detail page, else its list. */
export const ENTITY_HREF: Record<EntityKind, ((id: string) => string) | null> =
  {
    invoice: (id) => `/invoices/${id}`,
    receipt: (id) => `/receipts/${id}`,
    payment_order: (id) => `/payment-orders/${id}`,
    purchase_invoice: (id) => `/purchases/${id}`,
    trip: (id) => `/trips/${id}`,
    shipment: () => "/cargas",
    client: (id) => `/clients/${id}`,
    supplier: (id) => `/suppliers/${id}`,
    vehicle: () => "/vehicles",
    driver: () => "/drivers",
    employee: (id) => `/employees/${id}`,
    account: (id) => `/accounts/${id}`,
    user: () => "/admin/users",
    // Their pages were removed; past events still name them, unlinked.
    freight_settlement: null,
    driver_settlement: null,
    tax_document: () => "/taxes",
    loan: (id) => `/loans/${id}`,
    task: () => "/tasks",
    check: () => "/checks",
    issued_check: () => "/issued-checks",
    product: () => "/products",
    warehouse: () => "/warehouses",
    cost_center: () => "/accounting/cost-centers",
    recurring_payment: () => "/recurring-payments",
  };

/** Payload keys that name another record, and the kind they name. */
export const PAYLOAD_REFS: Record<string, EntityKind> = {
  client_id: "client",
  supplier_id: "supplier",
  employee_id: "employee",
  vehicle_id: "vehicle",
  driver_id: "driver",
  invoice_id: "invoice",
  nd_invoice_id: "invoice",
  trip_id: "trip",
  account_id: "account",
  destination_account_id: "account",
  expense_account_id: "account",
  from: "account",
  to: "account",
  purchaseInvoiceId: "purchase_invoice",
  linked_user_id: "user",
};

/** Payload keys holding lists of user ids (task assignees, role changes). */
export const PAYLOAD_USER_LISTS = ["assignee_ids", "added", "removed"] as const;
