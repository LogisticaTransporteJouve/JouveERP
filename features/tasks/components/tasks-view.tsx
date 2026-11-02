"use client";

import { AlertTriangle, Check, Lock, Plus, Repeat } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatArgentineDate, todayInAR } from "@/lib/format";

import { useSetTaskStatus, useTasks } from "../hooks/use-tasks";
import { TASK_SOURCES } from "../lib/sources";
import {
  DEFAULT_TASK_SCOPE,
  DEFAULT_TASK_STATUS,
  TASK_ORIGIN_LABELS,
  TASK_SCOPE_LABELS,
  TASK_SCOPES,
  TASK_STATUS_FILTER_LABELS,
  TASK_STATUS_FILTERS,
  type TaskListItem,
  type TaskScope,
  type TaskStatusFilter,
} from "../schema";

import { assigneesSummary, useUserLabels } from "./assignee-picker";
import { RecurringTasksDialog } from "./recurring-tasks-dialog";
import { TaskDetailDialog } from "./task-detail-dialog";
import { TaskFormDialog } from "./task-form-dialog";

function Segmented<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="bg-muted inline-flex rounded-md p-0.5"
    >
      {options.map((option) => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant={option === value ? "outline" : "ghost"}
          aria-pressed={option === value}
          className={option === value ? "bg-background" : undefined}
          onClick={() => onChange(option)}
        >
          {labels[option]}
        </Button>
      ))}
    </div>
  );
}

export function TasksView({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const linkedTask = searchParams.get("task");
  const [scope, setScope] = useState<TaskScope>(DEFAULT_TASK_SCOPE);
  const [status, setStatus] = useState<TaskStatusFilter>(DEFAULT_TASK_STATUS);
  const [selected, setSelected] = useState<string | null>(linkedTask);
  const [creating, setCreating] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);

  function closeDetail(open: boolean) {
    if (open) return;
    setSelected(null);
    // A notification's link opened it: drop ?task= so a reload does not.
    if (linkedTask) router.replace(pathname);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tareas</h1>
          <p className="text-muted-foreground text-sm">
            Pendientes del equipo: las que crean ustedes, las que se repiten
            cada mes y las que salen de los documentos por pagar, cobrar o
            renovar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setRecurringOpen(true)}>
            <Repeat />
            Recurrentes
          </Button>
          {canWrite && (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              Nueva tarea
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="De quién"
          options={TASK_SCOPES}
          labels={TASK_SCOPE_LABELS}
          value={scope}
          onChange={setScope}
        />
        <Segmented
          label="Estado"
          options={TASK_STATUS_FILTERS}
          labels={TASK_STATUS_FILTER_LABELS}
          value={status}
          onChange={setStatus}
        />
      </div>

      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <TasksTable
          scope={scope}
          status={status}
          canWrite={canWrite}
          onOpen={setSelected}
        />
      </Suspense>

      <TaskDetailDialog
        taskId={selected}
        canWrite={canWrite}
        onOpenChange={closeDetail}
      />
      {creating && (
        <TaskFormDialog
          open
          onOpenChange={(o) => {
            if (!o) setCreating(false);
          }}
        />
      )}
      <RecurringTasksDialog
        open={recurringOpen}
        onOpenChange={setRecurringOpen}
        canWrite={canWrite}
      />
    </div>
  );
}

function TasksTable({
  scope,
  status,
  canWrite,
  onOpen,
}: {
  scope: TaskScope;
  status: TaskStatusFilter;
  canWrite: boolean;
  onOpen: (id: string) => void;
}) {
  const { data } = useTasks(scope, status);
  const label = useUserLabels();
  const setTaskStatus = useSetTaskStatus();
  const today = todayInAR();

  const columns = useMemo<ColumnDef<TaskListItem>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Tarea",
        meta: { mobile: "primary" },
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="min-w-0">
              <p
                className={
                  t.status === "done"
                    ? "text-muted-foreground flex items-center gap-1.5 font-medium line-through"
                    : "flex items-center gap-1.5 font-medium"
                }
              >
                {t.restricted && (
                  <Lock className="text-muted-foreground size-3.5 shrink-0" />
                )}
                <span className="truncate">{t.title}</span>
              </p>
              <p className="text-muted-foreground text-xs">
                {t.kind
                  ? TASK_SOURCES[t.kind].label
                  : TASK_ORIGIN_LABELS[t.origin]}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: "due_date",
        header: "Vence",
        meta: { headerClassName: "w-36", mobile: "secondary" },
        cell: ({ row }) => {
          const t = row.original;
          const overdue =
            t.status === "open" && t.due_date !== null && t.due_date < today;
          return (
            <span className="inline-flex items-center gap-1 tabular-nums">
              {overdue && (
                <AlertTriangle className="size-3.5" aria-label="Vencida" />
              )}
              {formatArgentineDate(t.due_date)}
            </span>
          );
        },
      },
      {
        id: "assignees",
        header: "Responsables",
        enableSorting: false,
        meta: { mobile: "secondary" },
        cell: ({ row }) => (
          <span className="text-sm">
            {assigneesSummary(row.original.assignee_ids, label)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-28", align: "right", mobile: "primary" },
        cell: ({ row }) => {
          const t = row.original;
          if (!canWrite || t.restricted || t.status !== "open") return null;
          return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={setTaskStatus.isPending}
              onClick={(e) => {
                e.stopPropagation();
                setTaskStatus.mutate(
                  { id: t.id, status: "done" },
                  {
                    onSuccess: () => toast.success("Tarea hecha."),
                    onError: (err) => toast.error(err.message),
                  },
                );
              }}
            >
              <Check />
              Hecha
            </Button>
          );
        },
      },
    ],
    [canWrite, label, setTaskStatus, today],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data.rows}
        getRowId={(t) => t.id}
        onRowClick={(t) => onOpen(t.id)}
        emptyMessage={
          status === "done"
            ? "Todavía no hay tareas hechas."
            : "No hay tareas pendientes."
        }
      />
      {data.truncated && (
        <p className="text-muted-foreground text-xs">
          Se muestran las primeras {data.rows.length} tareas.
        </p>
      )}
    </>
  );
}
