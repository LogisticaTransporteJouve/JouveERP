import { z } from "zod";

import type { JsonValue } from "@/lib/actions/audit";
import { IsoDateSchema, UuidSchema } from "@/lib/validation/common";

/** audit_events.actor_type (check constraint in 20260616130000). */
export const AUDIT_ACTOR_TYPES = ["user", "ai-agent", "system"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export function isAuditActorType(value: string): value is AuditActorType {
  return (AUDIT_ACTOR_TYPES as readonly string[]).includes(value);
}

/** Events a list page returns; "Cargar más" asks for the next ones. */
export const AUDIT_PAGE_SIZE = 50;

/** Rows a CSV export carries at most; the toast says when there were more. */
export const AUDIT_EXPORT_LIMIT = 10_000;

/** Rows a record's history shows at most. */
export const RECORD_HISTORY_LIMIT = 100;

const EventTypeSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_.:-]{1,80}$/, "Acción inválida.");

const ModuleSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,40}$/, "Módulo inválido.");

/** The list's filters; empty means "any". */
export const AuditFiltersSchema = z
  .object({
    from: IsoDateSchema.nullish(),
    to: IsoDateSchema.nullish(),
    actorId: UuidSchema.nullish(),
    eventType: EventTypeSchema.nullish(),
    module: ModuleSchema.nullish(),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, {
    message: "La fecha desde no puede ser posterior a la fecha hasta.",
  });
export type AuditFilters = z.infer<typeof AuditFiltersSchema>;

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  from: null,
  to: null,
  actorId: null,
  eventType: null,
  module: null,
};

/** Keyset cursor: the last row of the previous page. */
export const AuditCursorSchema = z.object({
  // Goes into a PostgREST filter: only a timestamp's characters.
  ts: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/),
  id: UuidSchema,
});
export type AuditCursor = z.infer<typeof AuditCursorSchema>;

export const AuditListInputSchema = z.object({
  filters: AuditFiltersSchema,
  cursor: AuditCursorSchema.nullish(),
});

/** One audit event as the screen shows it, with sensitive values masked. */
export type AuditEventRow = {
  id: string;
  ts: string;
  actor_id: string | null;
  actor_type: AuditActorType;
  event_type: string;
  module: string;
  target_resource_id: string | null;
  target_user_id: string | null;
  /** Where the record lives, when the module has a page for it. */
  record_href: string | null;
  /** One line of what changed, from the payload. */
  summary: string | null;
  payload: JsonValue;
};

export type AuditPage = {
  rows: AuditEventRow[];
  nextCursor: AuditCursor | null;
};

export type AuditUserOption = { id: string; label: string };

export type AuditFilterOptions = {
  users: AuditUserOption[];
  eventTypes: string[];
};

export type AuditCsvExport = {
  fileName: string;
  csv: string;
  rows: number;
  truncated: boolean;
};
