import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

// --------------------------------------------------------------------------
// Enum + labels
// --------------------------------------------------------------------------

export const EMPLOYEE_DOCUMENT_KINDS = [
  "licencia_conducir",
  "lnh",
  "libreta_sanitaria",
  "curso_cargas_peligrosas",
  "curso_mercaderias_peligrosas",
  "aptitud_psicofisica",
  "aptitud_visual",
  "cedula_verde",
  "cedula_azul",
  "seguro_personal",
  "arn",
  "otro",
] as const;

export type EmployeeDocumentKind = (typeof EMPLOYEE_DOCUMENT_KINDS)[number];

export const EMPLOYEE_DOCUMENT_KIND_LABEL: Record<EmployeeDocumentKind, string> = {
  licencia_conducir: "Licencia de conducir",
  lnh: "Licencia Nacional Habilitante (LNH)",
  libreta_sanitaria: "Libreta sanitaria",
  curso_cargas_peligrosas: "Curso cargas peligrosas",
  curso_mercaderias_peligrosas: "Curso mercaderías peligrosas",
  aptitud_psicofisica: "Aptitud psicofísica",
  aptitud_visual: "Aptitud visual",
  cedula_verde: "Cédula verde",
  cedula_azul: "Cédula azul",
  seguro_personal: "Seguro personal",
  arn: "ARN (CNRT)",
  otro: "Otro",
};

export function isEmployeeDocumentKind(
  value: unknown,
): value is EmployeeDocumentKind {
  return (
    typeof value === "string" &&
    (EMPLOYEE_DOCUMENT_KINDS as readonly string[]).includes(value)
  );
}

// --------------------------------------------------------------------------
// Status helpers (derived from expires_at vs today)
// --------------------------------------------------------------------------

export type DocumentStatus = "valid" | "expiring_soon" | "expired";

/** Number of days to consider a document "expiring soon". Matches the cron window. */
export const DOCUMENT_EXPIRING_DAYS = 30;

export function getDocumentStatus(expiresAt: string): DocumentStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiresAt + "T00:00:00");
  const diffDays = Math.floor(
    (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return "expired";
  if (diffDays <= DOCUMENT_EXPIRING_DAYS) return "expiring_soon";
  return "valid";
}

export function getDocumentStatusLabel(status: DocumentStatus): string {
  return status === "valid"
    ? "Vigente"
    : status === "expiring_soon"
      ? "Por vencer"
      : "Vencido";
}

// --------------------------------------------------------------------------
// Zod schemas (server action boundary)
// --------------------------------------------------------------------------

const nullableText = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).");

export const EmployeeDocumentCreateSchema = z
  .object({
    employee_id: z.string().uuid(),
    kind: z.enum(EMPLOYEE_DOCUMENT_KINDS),
    number: nullableText,
    issued_at: isoDate.nullable().optional(),
    expires_at: isoDate,
    issuing_authority: nullableText,
    notes: nullableText,
    attachment_file_id: z.string().uuid().nullable().optional(),
  })
  .refine(
    (d) =>
      !d.issued_at || d.expires_at >= d.issued_at,
    {
      message: "La fecha de vencimiento debe ser posterior a la de emisión.",
      path: ["expires_at"],
    },
  );

export const EmployeeDocumentUpdateSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(EMPLOYEE_DOCUMENT_KINDS).optional(),
    number: nullableText,
    issued_at: isoDate.nullable().optional(),
    expires_at: isoDate.optional(),
    issuing_authority: nullableText,
    notes: nullableText,
    attachment_file_id: z.string().uuid().nullable().optional(),
  });

export type EmployeeDocumentCreateInput = z.infer<
  typeof EmployeeDocumentCreateSchema
>;
export type EmployeeDocumentUpdateInput = z.infer<
  typeof EmployeeDocumentUpdateSchema
>;

// --------------------------------------------------------------------------
// Row types (typed to narrow against Database)
// --------------------------------------------------------------------------

type EmployeeDocumentRow =
  Database["public"]["Tables"]["employee_documents"]["Row"];

export type EmployeeDocument = Omit<EmployeeDocumentRow, "kind"> & {
  kind: EmployeeDocumentKind;
};

/** Row shape of the v_documents_expiring view (not generated in types). */
export type ExpiringDocumentRow = {
  id: string;
  employee_id: string;
  kind: EmployeeDocumentKind;
  number: string | null;
  expires_at: string;
  notified_at: string | null;
  employee_name: string;
  employee_is_active: boolean;
  days_until_expiry: number;
};
