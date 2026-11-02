import { z } from "zod";

import { IsoDateSchema, UuidSchema } from "@/lib/validation/common";

export const TASK_STATUSES = ["open", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_ORIGINS = ["manual", "recurring", "automatic"] as const;
export type TaskOrigin = (typeof TASK_ORIGINS)[number];

/** The documents an automatic task comes from (tasks_source_known). */
export const AUTOMATIC_TASK_KINDS = [
  "supplier_payment",
  "collection",
  "loan_installment",
  "issued_check",
  "fleet_document",
  "employee_document",
  "vehicle_km",
] as const;
export type AutomaticTaskKind = (typeof AUTOMATIC_TASK_KINDS)[number];

export const TASK_SCOPES = ["mine", "all"] as const;
export type TaskScope = (typeof TASK_SCOPES)[number];

/** "overdue" = open with a due date before today (Argentine day). */
export const TASK_STATUS_FILTERS = ["open", "overdue", "done"] as const;
export type TaskStatusFilter = (typeof TASK_STATUS_FILTERS)[number];

/** What /tasks opens on: the viewer's open tasks. */
export const DEFAULT_TASK_SCOPE: TaskScope = "mine";
export const DEFAULT_TASK_STATUS: TaskStatusFilter = "open";

export const TASK_ORIGIN_LABELS: Record<TaskOrigin, string> = {
  manual: "Manual",
  recurring: "Recurrente",
  automatic: "Automática",
};

export const TASK_SCOPE_LABELS: Record<TaskScope, string> = {
  mine: "Mías",
  all: "Todas",
};

export const TASK_STATUS_FILTER_LABELS: Record<TaskStatusFilter, string> = {
  open: "Abiertas",
  overdue: "Vencidas",
  done: "Hechas",
};

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskOrigin(value: string): value is TaskOrigin {
  return (TASK_ORIGINS as readonly string[]).includes(value);
}

export function isAutomaticTaskKind(
  value: string | null,
): value is AutomaticTaskKind {
  return (
    value !== null &&
    (AUTOMATIC_TASK_KINDS as readonly string[]).includes(value)
  );
}

const TitleSchema = z
  .string()
  .trim()
  .min(1, "El título es obligatorio.")
  .max(200, "Máx 200 caracteres.");

/** Empty text means no description. */
const DescriptionSchema = z
  .string()
  .trim()
  .max(2000, "Máx 2000 caracteres.")
  .nullish()
  .transform((v) => (v ? v : null));

const AssigneesSchema = z
  .array(UuidSchema)
  .max(20, "Máx 20 responsables.")
  .transform((ids) => [...new Set(ids)]);

export const TaskListInputSchema = z.object({
  scope: z.enum(TASK_SCOPES),
  status: z.enum(TASK_STATUS_FILTERS),
});
export type TaskListInput = z.infer<typeof TaskListInputSchema>;

export const TaskCreateSchema = z.object({
  title: TitleSchema,
  description: DescriptionSchema,
  due_date: IsoDateSchema.nullish().transform((v) => v ?? null),
  assignee_ids: AssigneesSchema,
});
export type TaskCreateInput = z.input<typeof TaskCreateSchema>;

export const TaskStatusUpdateSchema = z.object({
  id: UuidSchema,
  status: z.enum(TASK_STATUSES),
});

export const TaskDueDateUpdateSchema = z.object({
  id: UuidSchema,
  due_date: IsoDateSchema.nullable(),
});

export const TaskAssigneesUpdateSchema = z.object({
  id: UuidSchema,
  assignee_ids: AssigneesSchema,
});

export const TaskCommentCreateSchema = z.object({
  task_id: UuidSchema,
  body: z
    .string()
    .trim()
    .min(1, "Escribí un comentario.")
    .max(2000, "Máx 2000 caracteres."),
});

export const RecurringTaskCreateSchema = z.object({
  title: TitleSchema,
  description: DescriptionSchema,
  day_of_month: z.coerce
    .number()
    .int()
    .min(1, "Día entre 1 y 31.")
    .max(31, "Día entre 1 y 31."),
  assignee_ids: AssigneesSchema,
});
export type RecurringTaskCreateInput = z.input<
  typeof RecurringTaskCreateSchema
>;

export const RecurringTaskUpdateSchema =
  RecurringTaskCreateSchema.partial().extend({
    id: UuidSchema,
    is_active: z.boolean().optional(),
  });
export type RecurringTaskUpdateInput = z.input<
  typeof RecurringTaskUpdateSchema
>;

/** A task as a viewer may see it: `restricted` when it comes from a module
 *  the viewer cannot read, with the title, description and source hidden. */
export type TaskListItem = {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: TaskStatus;
  origin: TaskOrigin;
  kind: AutomaticTaskKind | null;
  restricted: boolean;
  /** The module page the document lives in; null when restricted or manual. */
  source_href: string | null;
  auto_closed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  assignee_ids: string[];
};

export type TaskComment = {
  id: string;
  author_id: string | null;
  body: string;
  created_at: string;
};

export type TaskHistoryEvent = {
  id: string;
  event_type: string;
  actor_id: string | null;
  ts: string;
};

export type TaskDetail = TaskListItem & {
  comments: TaskComment[];
  history: TaskHistoryEvent[];
};

export type TaskList = {
  rows: TaskListItem[];
  /** More tasks matched than the list returns. */
  truncated: boolean;
};

export type TaskUserOption = {
  id: string;
  label: string;
};

export type RecurringTask = {
  id: string;
  title: string;
  description: string | null;
  day_of_month: number;
  is_active: boolean;
  assignee_ids: string[];
};
