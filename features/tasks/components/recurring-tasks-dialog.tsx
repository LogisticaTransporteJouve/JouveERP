"use client";

import { Pencil } from "lucide-react";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { IconButton } from "@/components/ui/icon-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import { useRecurringTasks, useUpdateRecurringTask } from "../hooks/use-tasks";
import type { RecurringTask } from "../schema";

import { AssigneeInitials } from "./assignee-picker";
import { TaskFormDialog } from "./task-form-dialog";

/** Managing recurring tasks needs `tasks:write`; the caller mounts it only then. */
export function RecurringTasksDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tareas recurrentes</DialogTitle>
          <DialogDescription>
            Se crean solas una semana antes de su día de cada mes.
          </DialogDescription>
        </DialogHeader>
        <Suspense fallback={<Skeleton className="h-24 w-full" />}>
          <RecurringList />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}

function RecurringList() {
  const { data: items } = useRecurringTasks();
  const update = useUpdateRecurringTask();
  const [editing, setEditing] = useState<RecurringTask | null>(null);

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Sin tareas recurrentes. Creá una desde «Nueva tarea».
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y">
        {items.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p
                className={
                  r.is_active
                    ? "truncate text-sm font-medium"
                    : "text-muted-foreground truncate text-sm font-medium"
                }
              >
                {r.title}
              </p>
              <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                <span>Día {r.day_of_month}</span>
                <AssigneeInitials ids={r.assignee_ids} />
              </div>
            </div>
            <Switch
              checked={r.is_active}
              aria-label={r.is_active ? "Desactivar" : "Activar"}
              disabled={update.isPending}
              onCheckedChange={(checked) =>
                update.mutate(
                  { id: r.id, is_active: checked },
                  { onError: (err) => toast.error(err.message) },
                )
              }
            />
            <IconButton
              label="Editar"
              type="button"
              variant="ghost"
              onClick={() => setEditing(r)}
            >
              <Pencil className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
      {editing && (
        <TaskFormDialog
          open
          recurring={editing}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
    </>
  );
}
