import {
  TREASURY_PERMISSIONS,
  userCanAll,
  type Access,
  type Permission,
} from "@/lib/auth/permissions";

import type { AutomaticTaskKind, TaskOrigin } from "../schema";

type TaskSource = {
  /** What the task is about, shown as its type. */
  label: string;
  /** Reading the task's title, description and link needs every one. */
  read: readonly Permission[];
  /** Who the cron assigns a new task to (plus tasks:read). */
  assign: readonly Permission[];
  /** The module page where the document is settled. */
  href: string;
};

export const TASK_SOURCES: Record<AutomaticTaskKind, TaskSource> = {
  supplier_payment: {
    label: "Pago a proveedor",
    read: ["purchase_invoices:read"],
    assign: ["purchase_invoices:read", "payment_orders:write"],
    href: "/purchases",
  },
  collection: {
    label: "Cobranza vencida",
    read: ["invoices:read"],
    assign: ["invoices:read", "receipts:write"],
    href: "/invoices",
  },
  loan_installment: {
    label: "Cuota de préstamo",
    read: TREASURY_PERMISSIONS,
    assign: [...TREASURY_PERMISSIONS, "accounts:write"],
    href: "/loans",
  },
  issued_check: {
    label: "Cheque propio",
    read: ["issued_checks:read"],
    assign: ["issued_checks:write"],
    href: "/issued-checks",
  },
  fleet_document: {
    label: "Documento de flota",
    read: ["fleet_documents:read"],
    assign: ["fleet_documents:write"],
    href: "/fleet-documents",
  },
  employee_document: {
    label: "Documento de empleado",
    read: ["hr:read"],
    assign: ["hr:write"],
    href: "/hr/document-expirations",
  },
  vehicle_km: {
    label: "Km mensual",
    read: ["fleet_km:read"],
    assign: ["fleet_km:write"],
    href: "/vehicle-km",
  },
  tax_document: {
    label: "Impuesto",
    read: ["taxes:read"],
    assign: ["taxes:write"],
    href: "/taxes",
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
