"use client";

import {
  Banknote,
  Check,
  ExternalLink,
  HandCoins,
  Lock,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatArgentineDateTime } from "@/lib/format";

import {
  useAddTaskComment,
  useSetTaskAssignees,
  useSetTaskDueDate,
  useSetTaskStatus,
  useTaskDetail,
} from "../hooks/use-tasks";
import { TASK_SOURCES } from "../lib/sources";
import { TASK_ORIGIN_LABELS, type TaskDetail } from "../schema";

import { AssigneePicker, useUserLabels } from "./assignee-picker";

const HISTORY_LABELS: Record<string, string> = {
  "task.created": "creó la tarea",
  "task.completed": "la marcó como hecha",
  "task.reopened": "la reabrió",
  "task.due_date_changed": "cambió el vencimiento",
  "task.assigned": "cambió los responsables",
  "task.commented": "comentó",
};

export function TaskDetailDialog({
  taskId,
  canWrite,
  onOpenChange,
}: {
  taskId: string | null;
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={taskId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {taskId && (
          <Suspense fallback={<DetailSkeleton />}>
            <TaskDetailBody taskId={taskId} canWrite={canWrite} />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-3">
      <DialogHeader>
        <DialogTitle>Tarea</DialogTitle>
        <DialogDescription>Cargando…</DialogDescription>
      </DialogHeader>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function TaskDetailBody({
  taskId,
  canWrite,
}: {
  taskId: string;
  canWrite: boolean;
}) {
  const { data: task } = useTaskDetail(taskId);
  const label = useUserLabels();
  const setStatus = useSetTaskStatus();
  const setDueDate = useSetTaskDueDate();
  const setAssignees = useSetTaskAssignees();
  // A restricted task is shown, not changed (the server refuses too).
  const editable = canWrite && !task.restricted;
  const done = task.status === "done";

  function toggleStatus() {
    setStatus.mutate(
      { id: task.id, status: done ? "open" : "done" },
      {
        onSuccess: () =>
          toast.success(done ? "Tarea reabierta." : "Tarea hecha."),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-start gap-2 pr-6">
          {task.restricted && (
            <Lock className="text-muted-foreground mt-1 size-4 shrink-0" />
          )}
          <span className={done ? "line-through" : undefined}>
            {task.title}
          </span>
        </DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{TASK_ORIGIN_LABELS[task.origin]}</Badge>
            {task.kind && (
              <Badge variant="outline">{TASK_SOURCES[task.kind].label}</Badge>
            )}
            <Badge variant={done ? "secondary" : "outline"}>
              {done ? "Hecha" : "Abierta"}
            </Badge>
          </div>
        </DialogDescription>
      </DialogHeader>

      {task.restricted && (
        <p className="text-muted-foreground text-sm">
          Esta tarea sale de un módulo al que no tenés acceso: no se muestra su
          detalle.
        </p>
      )}
      {task.description && (
        <p className="text-sm whitespace-pre-wrap">{task.description}</p>
      )}
      <SourceActions task={task} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="task-due-date">Vencimiento</Label>
          <DatePicker
            id="task-due-date"
            value={task.due_date ?? ""}
            onChange={(iso) =>
              setDueDate.mutate(
                { id: task.id, due_date: iso || null },
                { onError: (err) => toast.error(err.message) },
              )
            }
            clearable
            disabled={!editable || setDueDate.isPending}
            className="w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="task-assignees">Responsables</Label>
          <AssigneePicker
            id="task-assignees"
            value={task.assignee_ids}
            onChange={(ids) =>
              setAssignees.mutate(
                { id: task.id, assignee_ids: ids },
                { onError: (err) => toast.error(err.message) },
              )
            }
            disabled={!editable || setAssignees.isPending}
          />
        </div>
      </div>

      {done && (
        <p className="text-muted-foreground text-sm">
          {task.auto_closed
            ? "Se cerró sola: el documento ya no tiene nada pendiente."
            : `Hecha ${formatArgentineDateTime(task.completed_at)}${
                task.completed_by ? ` por ${label(task.completed_by)}` : ""
              }.`}
        </p>
      )}

      {/* An automatic task is closed only by the sync, once its document is
          settled (the action and the database refuse it too). */}
      {editable && (done || task.origin !== "automatic") && (
        <Button
          type="button"
          variant={done ? "outline" : "default"}
          onClick={toggleStatus}
          disabled={setStatus.isPending}
        >
          {done ? <RotateCcw /> : <Check />}
          {done ? "Reabrir" : "Marcar como hecha"}
        </Button>
      )}

      <Separator />
      <Comments task={task} canComment={editable} />
      <Separator />
      <History task={task} />
    </div>
  );
}

/** What settles an automatic task's document: «Cobrar» / «Pagar» on its page
 *  when the viewer may, else «Ir al documento»; for an open task, the line
 *  that says it closes by itself. */
function SourceActions({ task }: { task: TaskDetail }) {
  if (!task.source_href) return null;
  const open = task.status === "open";
  const closesWhen =
    open && task.origin === "automatic" && task.kind
      ? TASK_SOURCES[task.kind].closesWhen
      : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {task.settle ? (
          <Button asChild>
            <Link href={task.settle.href}>
              {task.settle.label === "Cobrar" ? <HandCoins /> : <Banknote />}
              {task.settle.label}
            </Link>
          </Button>
        ) : null}
        <Button
          asChild
          variant={open && !task.settle ? "default" : "link"}
          className={open && !task.settle ? undefined : "h-auto p-0"}
        >
          <Link href={task.source_href}>
            <ExternalLink className="size-4" />
            Ir al documento
          </Link>
        </Button>
      </div>
      {closesWhen && (
        <p className="text-muted-foreground text-sm">
          Se cierra sola cuando {closesWhen}.
        </p>
      )}
    </div>
  );
}

function Comments({
  task,
  canComment,
}: {
  task: TaskDetail;
  canComment: boolean;
}) {
  const label = useUserLabels();
  const addComment = useAddTaskComment();
  const [body, setBody] = useState("");

  function submit() {
    addComment.mutate(
      { task_id: task.id, body },
      {
        onSuccess: () => setBody(""),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">Comentarios</h3>
      {task.comments.length === 0 ? (
        <p className="text-muted-foreground text-sm">Sin comentarios.</p>
      ) : (
        <ul className="space-y-3">
          {task.comments.map((c) => (
            <li key={c.id} className="text-sm">
              <p className="text-muted-foreground text-xs">
                {c.author_id ? label(c.author_id) : "Usuario eliminado"} ·{" "}
                {formatArgentineDateTime(c.created_at)}
              </p>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <div className="space-y-2">
          <Textarea
            aria-label="Nuevo comentario"
            placeholder="Escribí un comentario"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={2000}
          />
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={addComment.isPending || body.trim() === ""}
          >
            Comentar
          </Button>
        </div>
      )}
    </section>
  );
}

function History({ task }: { task: TaskDetail }) {
  const label = useUserLabels();
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Historial</h3>
      <ul className="text-muted-foreground space-y-1 text-xs">
        <li>
          {task.origin === "manual"
            ? "Creada"
            : task.origin === "recurring"
              ? "Creada por la recurrencia"
              : "Creada automáticamente"}{" "}
          el {formatArgentineDateTime(task.created_at)}
        </li>
        {task.history
          .filter((h) => h.event_type !== "task.created")
          .map((h) => (
            <li key={h.id}>
              {formatArgentineDateTime(h.ts)} ·{" "}
              {h.actor_id ? label(h.actor_id) : "Sistema"}{" "}
              {HISTORY_LABELS[h.event_type] ?? h.event_type}
            </li>
          ))}
        {task.auto_closed && <li>Se cerró automáticamente</li>}
      </ul>
    </section>
  );
}
