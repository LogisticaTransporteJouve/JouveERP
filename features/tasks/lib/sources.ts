import {
  TREASURY_PERMISSIONS,
  userCanAll,
  type Access,
  type Permission,
} from "@/lib/auth/permissions";

import { PAYMENT_ORDER_FORM_PERMISSIONS } from "@/features/payment-orders/lib/payment-order-form";
import { RECEIPT_FORM_PERMISSIONS } from "@/features/receipts/lib/receipt-form";

import type {
  AutomaticTaskKind,
  TaskOrigin,
  TaskSettleAction,
} from "../schema";

type TaskSource = {
  /** What the task is about, shown as its type. */
  label: string;
  /** Reading the task's title, description and link needs every one. */
  read: readonly Permission[];
  /** Who the cron assigns a new task to (plus tasks:read). */
  assign: readonly Permission[];
  /** The module page where the document is settled. */
  href: string;
  /** The record's own page, from the task's source id and, for a document
   *  that lives inside another record, that record's id. Absent when the
   *  module has no detail page. */
  detailHref?: (sourceId: string, parentId: string | null) => string | null;
  /** The button that settles the document on its detail page, opened there
   *  through `?<param>=1`, gated as that page gates it. */
  settle?: {
    label: TaskSettleAction["label"];
    param: string;
    permissions: readonly Permission[];
  };
  /** «Se cierra sola cuando …»: what settles the document. */
  closesWhen: string;
};

export const TASK_SOURCES: Record<AutomaticTaskKind, TaskSource> = {
  supplier_payment: {
    label: "Pago a proveedor",
    read: ["purchase_invoices:read"],
    assign: ["purchase_invoices:read", "payment_orders:write"],
    href: "/purchases",
    detailHref: (id) => `/purchases/${id}`,
    // The purchase page offers «Pagar» to whoever reads payment orders and
    // can open the OP form.
    settle: {
      label: "Pagar",
      param: "pagar",
      permissions: ["payment_orders:read", ...PAYMENT_ORDER_FORM_PERMISSIONS],
    },
    closesWhen: "se pague",
  },
  collection: {
    label: "Cobranza vencida",
    read: ["invoices:read"],
    assign: ["invoices:read", "receipts:write"],
    href: "/invoices",
    detailHref: (id) => `/invoices/${id}`,
    settle: {
      label: "Cobrar",
      param: "cobrar",
      permissions: RECEIPT_FORM_PERMISSIONS,
    },
    closesWhen: "se cobre",
  },
  loan_installment: {
    label: "Cuota de préstamo",
    read: TREASURY_PERMISSIONS,
    assign: [...TREASURY_PERMISSIONS, "accounts:write"],
    href: "/loans",
    detailHref: (_id, loanId) => (loanId ? `/loans/${loanId}` : null),
    closesWhen: "se pague la cuota",
  },
  issued_check: {
    label: "Cheque propio",
    read: ["issued_checks:read"],
    assign: ["issued_checks:write"],
    href: "/issued-checks",
    closesWhen: "se debite el cheque",
  },
  fleet_document: {
    label: "Documento de flota",
    read: ["fleet_documents:read"],
    assign: ["fleet_documents:write"],
    href: "/fleet-documents",
    closesWhen: "se renueve",
  },
  employee_document: {
    label: "Documento de empleado",
    read: ["hr:read"],
    assign: ["hr:write"],
    href: "/hr/document-expirations",
    detailHref: (_id, employeeId) =>
      employeeId ? `/employees/${employeeId}` : null,
    closesWhen: "se renueve",
  },
  vehicle_km: {
    label: "Km mensual",
    read: ["fleet_km:read"],
    assign: ["fleet_km:write"],
    href: "/vehicle-km",
    closesWhen: "se carguen los km del mes",
  },
  tax_document: {
    label: "Impuesto",
    read: ["taxes:read"],
    assign: ["taxes:write"],
    href: "/taxes",
    closesWhen: "se pague",
  },
};

/** What a viewer without the source module's permission sees as the title. */
export const RESTRICTED_TASK_TITLE = "Tarea de un módulo sin acceso";

/** Whether `access` may see what a task is about. Manual and recurring tasks
 *  carry no document; an automatic one needs its module's read permission. */
export function canSeeTaskSource(
  access: Access,
  task: { origin: TaskOrigin; kind: AutomaticTaskKind | null },
): boolean {
  if (task.origin !== "automatic") return true;
  if (!task.kind) return false;
  return userCanAll(access, TASK_SOURCES[task.kind].read);
}

/** Where «Ir al documento» goes and the button that settles the document,
 *  for a task `access` may see (canSeeTaskSource). The settle button shows
 *  only on an open task and under the permissions the document's page gates
 *  it on; that page still decides whether there is anything to settle. */
export function taskSourceLinks(
  access: Access,
  task: {
    kind: AutomaticTaskKind;
    source_id: string;
    parent_id: string | null;
    open: boolean;
  },
): { href: string; settle: TaskSettleAction | null } {
  const source = TASK_SOURCES[task.kind];
  const detail = source.detailHref?.(task.source_id, task.parent_id) ?? null;
  const settle =
    detail &&
    source.settle &&
    task.open &&
    userCanAll(access, source.settle.permissions)
      ? {
          label: source.settle.label,
          href: `${detail}?${source.settle.param}=1`,
        }
      : null;
  return { href: detail ?? source.href, settle };
}
