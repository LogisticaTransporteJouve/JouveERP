"use client";

import { Pencil } from "lucide-react";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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

import { assigneesSummary, useUserLabels } from "./assignee-picker";
import { TaskFormDialog } from "./task-form-dialog";

export function RecurringTasksDialog({
  open,
  onOpenChange,
  canWrite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
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
          <RecurringList canWrite={canWrite} />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}

function RecurringList({ canWrite }: { canWrite: boolean }) {
  const { data: items } = useRecurringTasks();
  const label = useUserLabels();
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
              <p className="text-muted-foreground truncate text-xs">
                Día {r.day_of_month} · {assigneesSummary(r.assignee_ids, label)}
              </p>
            </div>
            {canWrite && (
              <>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Editar"
                  onClick={() => setEditing(r)}
                >
                  <Pencil className="size-4" />
                </Button>
              </>
            )}
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
