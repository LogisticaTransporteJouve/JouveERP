"use server";

import { logAudit } from "@/lib/actions/audit";
import { createTask } from "@/lib/commands/create-task";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, type Access } from "@/lib/auth/permissions";
import {
  listUserIdsWithPermission,
  listUsersWithRoles,
} from "@/lib/auth/users";
import { getInitials } from "@/lib/avatars";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { fetchInChunks } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";
import { UuidSchema } from "@/lib/validation/common";

import { assigneesError } from "../lib/assignees";
import {
  canSeeTaskSource,
  RESTRICTED_TASK_TITLE,
  TASK_SOURCES,
  taskSourceLinks,
} from "../lib/sources";
import {
  TaskAssigneesUpdateSchema,
  TaskCommentCreateSchema,
  TaskCreateSchema,
  TaskDueDateUpdateSchema,
  TaskListInputSchema,
  TaskStatusUpdateSchema,
  isAutomaticTaskKind,
  isTaskOrigin,
  isTaskStatus,
  type AutomaticTaskKind,
  type TaskDetail,
  type TaskList,
  type TaskListItem,
  type TaskOrigin,
  type TaskUserOption,
} from "../schema";

/** Rows a list returns at most; the UI says when there were more. */
const TASKS_LIST_LIMIT = 300;

const TASK_COLUMNS =
  "id, title, description, due_date, status, origin, kind, source_table, source_id, auto_closed, completed_at, completed_by, created_at, assignees:task_assignees(user_id)";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
  origin: string;
  kind: string | null;
  source_table: string | null;
  source_id: string | null;
  auto_closed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  assignees: { user_id: string }[];
};

/** Source id → the id of the record that source row lives in. */
type SourceParents = Map<string, string>;

/** Ids of `table`'s rows among the tasks. */
function sourceIds(rows: readonly TaskRow[], table: string): string[] {
  return rows.flatMap((r) =>
    r.source_table === table && r.source_id ? [r.source_id] : [],
  );
}

/** The loan of each installment and the employee of each document among
 *  `rows`, so their tasks link to that record. A failed read is logged and
 *  leaves those tasks on their module's page. */
async function loadSourceParents(
  rows: readonly TaskRow[],
): Promise<SourceParents> {
  const service = getServiceClient();
  const [installments, documents] = await Promise.all([
    fetchInChunks(sourceIds(rows, "loan_installments"), (ids) =>
      service.from("loan_installments").select("id, loan_id").in("id", ids),
    ),
    fetchInChunks(sourceIds(rows, "employee_documents"), (ids) =>
      service
        .from("employee_documents")
        .select("id, employee_id")
        .in("id", ids),
    ),
  ]);
  const parents: SourceParents = new Map();
  if (installments.error || documents.error) {
    logger.error("tasks.source_parents.failed", {
      error: installments.error ?? documents.error,
    });
  }
  for (const r of installments.data ?? []) parents.set(r.id, r.loan_id);
  for (const r of documents.data ?? []) parents.set(r.id, r.employee_id);
  return parents;
}

/** The row as `access` may see it, or null for a value the schema does not
 *  know (logged). */
function toListItem(
  row: TaskRow,
  access: Access,
  parents: SourceParents,
): TaskListItem | null {
  const kind = isAutomaticTaskKind(row.kind) ? row.kind : null;
  if (!isTaskStatus(row.status) || !isTaskOrigin(row.origin)) {
    logger.error("tasks.unknown_enum", {
      id: row.id,
      status: row.status,
      origin: row.origin,
    });
    return null;
  }
  const visible = canSeeTaskSource(access, { origin: row.origin, kind });
  const links =
    visible && kind && row.source_table && row.source_id
      ? taskSourceLinks(access, {
          kind,
          source_id: row.source_id,
          parent_id: parents.get(row.source_id) ?? null,
          open: row.status === "open",
        })
      : null;
  return {
    id: row.id,
    title: visible ? row.title : RESTRICTED_TASK_TITLE,
    description: visible ? row.description : null,
    due_date: row.due_date,
    status: row.status,
    origin: row.origin,
    kind: visible ? kind : null,
    restricted: !visible,
    source_href: links?.href ?? null,
    settle: links?.settle ?? null,
    auto_closed: row.auto_closed,
    completed_at: row.completed_at,
    completed_by: row.completed_by,
    created_at: row.created_at,
    assignee_ids: row.assignees.map((a) => a.user_id),
  };
}

export async function listTasksAction(
  input: unknown,
): Promise<ActionResult<TaskList>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "tasks:read")) {
    return { ok: false, error: "No tenés permiso para ver tareas." };
  }
  const parsed = TaskListInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Filtro inválido." };
  const { scope, status } = parsed.data;

  const service = getServiceClient();
  // `mine` is the viewer's own assignment, embedded to filter by it.
  let query = service
    .from("tasks")
    .select(`${TASK_COLUMNS}, mine:task_assignees(user_id)`)
    .eq("mine.user_id", ctx.userId);
  if (scope === "mine") query = query.not("mine", "is", null);
  if (status === "done") {
    query = query
      .eq("status", "done")
      .order("completed_at", { ascending: false });
  } else {
    query = query.eq("status", "open");
    if (status === "overdue") query = query.lt("due_date", todayInAR());
    query = query.order("due_date", { ascending: true, nullsFirst: false });
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(TASKS_LIST_LIMIT + 1);
  if (error) {
    logger.error("tasks.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar las tareas." };
  }

  const page = (data ?? []).slice(0, TASKS_LIST_LIMIT);
  const parents = await loadSourceParents(page);
  const rows = page
    .map((row) => toListItem(row, ctx.access, parents))
    .filter((row): row is TaskListItem => row !== null);
  return {
    ok: true,
    data: { rows, truncated: (data ?? []).length > TASKS_LIST_LIMIT },
  };
}

export async function getTaskDetailAction(
  id: string,
): Promise<ActionResult<TaskDetail>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "tasks:read")) {
    return { ok: false, error: "No tenés permiso para ver tareas." };
  }
  if (!UuidSchema.safeParse(id).success) {
    return { ok: false, error: "La tarea no existe." };
  }

  const service = getServiceClient();
  const [task, comments, history] = await Promise.all([
    service.from("tasks").select(TASK_COLUMNS).eq("id", id).maybeSingle(),
    service
      .from("task_comments")
      .select("id, author_id, body, created_at")
      .eq("task_id", id)
      .order("created_at", { ascending: true }),
    service
      .from("audit_events")
      .select("id, event_type, actor_id, ts")
      .eq("target_resource_id", id)
      .like("event_type", "task.%")
      .order("ts", { ascending: true }),
  ]);
  const failed = task.error ?? comments.error ?? history.error;
  if (failed) {
    logger.error("tasks.detail.failed", { userId: ctx.userId, id, failed });
    return { ok: false, error: "No se pudo cargar la tarea." };
  }
  if (!task.data) return { ok: false, error: "La tarea no existe." };

  const item = toListItem(
    task.data,
    ctx.access,
    await loadSourceParents([task.data]),
  );
  if (!item) return { ok: false, error: "No se pudo cargar la tarea." };
  // The service client skips RLS: a task whose source module the viewer
  // cannot read keeps its comments and history hidden, like its title.
  return {
    ok: true,
    data: {
      ...item,
      comments: item.restricted ? [] : (comments.data ?? []),
      history: item.restricted ? [] : (history.data ?? []),
    },
  };
}

/** Users who can be given a task: whoever holds tasks:read now. */
export async function listTaskUserOptionsAction(): Promise<
  ActionResult<TaskUserOption[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "tasks:read")) {
    return { ok: false, error: "No tenés permiso para ver tareas." };
  }
  try {
    const [holders, users] = await Promise.all([
      listUserIdsWithPermission("tasks:read"),
      listUsersWithRoles(),
    ]);
    const ids = new Set(holders);
    const { data: profiles, error } = await getServiceClient()
      .from("user_profiles")
      .select("user_id, first_name, last_name")
      .in("user_id", holders);
    if (error) throw error;
    const byId = new Map((profiles ?? []).map((p) => [p.user_id, p]));
    const options = users
      .filter((u) => ids.has(u.id))
      .map((u) => {
        const p = byId.get(u.id);
        const name =
          `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || u.email;
        return {
          id: u.id,
          label: name,
          initials: getInitials(p?.first_name, p?.last_name, u.email),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
    return { ok: true, data: options };
  } catch (error) {
    logger.error("tasks.user_options.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar los usuarios." };
  }
}

export async function createTaskAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "tasks:write")) {
    return { ok: false, error: "No tenés permiso para crear tareas." };
  }
  const parsed = TaskCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return createTask(ctx.userId, parsed.data);
}

type WritableTask = {
  id: string;
  origin: TaskOrigin;
  kind: AutomaticTaskKind | null;
  status: string;
};

/** The task `access` may change: it exists and its source module is
 *  readable (a restricted task is shown with a neutral title, not edited). */
async function loadWritableTask(
  access: Access,
  id: string,
): Promise<ActionResult<WritableTask>> {
  const { data, error } = await getServiceClient()
    .from("tasks")
    .select("id, origin, kind, status")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: "No se pudo cargar la tarea." };
  if (!data || !isTaskOrigin(data.origin)) {
    return { ok: false, error: "La tarea no existe." };
  }
  const kind = isAutomaticTaskKind(data.kind) ? data.kind : null;
  if (!canSeeTaskSource(access, { origin: data.origin, kind })) {
    return { ok: false, error: "No tenés acceso al módulo de esta tarea." };
  }
  return {
    ok: true,
    data: { id: data.id, origin: data.origin, kind, status: data.status },
  };
}

export async function setTaskStatusAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "tasks:write")) {
    return { ok: false, error: "No tenés permiso para editar tareas." };
  }
  const parsed = TaskStatusUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const task = await loadWritableTask(ctx.access, parsed.data.id);
  if (!task.ok) return task;

  const done = parsed.data.status === "done";
  // Only sync_automatic_tasks closes an automatic task, once its document has
  // nothing pending (guard_automatic_task_close refuses it too).
  if (done && task.data.origin === "automatic") {
    const closesWhen = task.data.kind
      ? TASK_SOURCES[task.data.kind].closesWhen
      : null;
    return {
      ok: false,
      error: closesWhen
        ? `Esta tarea se cierra sola cuando ${closesWhen}.`
        : "Esta tarea se cierra sola cuando su documento queda saldado.",
    };
  }
  const { data, error } = await getServiceClient()
    .from("tasks")
    .update({
      status: parsed.data.status,
      completed_at: done ? new Date().toISOString() : null,
      completed_by: done ? ctx.userId : null,
      auto_closed: false,
    })
    .eq("id", parsed.data.id)
    .eq("status", done ? "open" : "done")
    .select("id");
  if (error) {
    const guard = mapDbGuardError(error, {
      slug: "tasks.status.rejected",
      userId: ctx.userId,
      id: parsed.data.id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("tasks.status.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo actualizar la tarea." };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: done ? "La tarea ya estaba hecha." : "La tarea ya estaba abierta.",
    };
  }

  await logAudit(
    done ? "task.completed" : "task.reopened",
    ctx.userId,
    {},
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

export async function setTaskDueDateAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "tasks:write")) {
    return { ok: false, error: "No tenés permiso para editar tareas." };
  }
  const parsed = TaskDueDateUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Fecha inválida." };
  const task = await loadWritableTask(ctx.access, parsed.data.id);
  if (!task.ok) return task;

  const { data, error } = await getServiceClient()
    .from("tasks")
    .update({
      due_date: parsed.data.due_date,
      // The sync keeps a date a user chose over the document's.
      due_date_locked: task.data.origin === "automatic",
      notified_stage: null,
    })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) {
    logger.error("tasks.due_date.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cambiar el vencimiento." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "La tarea no existe." };
  }

  await logAudit(
    "task.due_date_changed",
    ctx.userId,
    { due_date: parsed.data.due_date },
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

export async function setTaskAssigneesAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "tasks:write")) {
    return { ok: false, error: "No tenés permiso para reasignar tareas." };
  }
  const parsed = TaskAssigneesUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const task = await loadWritableTask(ctx.access, parsed.data.id);
  if (!task.ok) return task;

  const service = getServiceClient();
  const { data: current, error: readError } = await service
    .from("task_assignees")
    .select("user_id")
    .eq("task_id", parsed.data.id);
  if (readError) {
    logger.error("tasks.assignees.read_failed", {
      userId: ctx.userId,
      error: readError,
    });
    return { ok: false, error: "No se pudo reasignar la tarea." };
  }
  const before = new Set((current ?? []).map((a) => a.user_id));
  const after = new Set(parsed.data.assignee_ids);
  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  if (added.length === 0 && removed.length === 0) {
    return { ok: true, data: undefined };
  }
  // Only the new ones must hold tasks:read; one who lost it can be removed.
  const invalid = await assigneesError(added);
  if (invalid) return { ok: false, error: invalid };

  // Removals and additions in one transaction, against the set as it is
  // when the task is locked.
  const { data, error } = await service.rpc("set_task_assignees", {
    p_task_id: parsed.data.id,
    p_assignee_ids: parsed.data.assignee_ids,
    p_actor: ctx.userId,
  });
  if (error) {
    const guard = mapDbGuardError(error, {
      slug: "tasks.assignees.rejected",
      userId: ctx.userId,
      id: parsed.data.id,
    });
    if (guard) return { ok: false, error: guard };
    logger.error("tasks.assignees.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo reasignar la tarea." };
  }
  const changed = data?.[0];
  // A concurrent reassignment already left the same set: nothing to audit.
  if (
    !changed ||
    (changed.added.length === 0 && changed.removed.length === 0)
  ) {
    return { ok: true, data: undefined };
  }

  await logAudit(
    "task.assigned",
    ctx.userId,
    { added: changed.added, removed: changed.removed },
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}

export async function addTaskCommentAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "tasks:write")) {
    return { ok: false, error: "No tenés permiso para comentar tareas." };
  }
  const parsed = TaskCommentCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const task = await loadWritableTask(ctx.access, parsed.data.task_id);
  if (!task.ok) return task;

  const { data, error } = await getServiceClient()
    .from("task_comments")
    .insert({
      task_id: parsed.data.task_id,
      author_id: ctx.userId,
      body: parsed.data.body,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("tasks.comment.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo guardar el comentario." };
  }

  await logAudit(
    "task.commented",
    ctx.userId,
    { comment_id: data.id },
    parsed.data.task_id,
  );
  return { ok: true, data: { id: data.id } };
}
