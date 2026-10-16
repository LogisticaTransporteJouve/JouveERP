"use client";

import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  ListChecks,
  Loader,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { formatArgentineDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { AiMarkdown } from "../../lib/markdown";
import {
  useAiWorkflowRuns,
  useAiWorkflows,
  useDeleteAiWorkflow,
  useSetAiWorkflowActive,
} from "../hooks/use-ai-workflows";
import {
  RUN_STATUSES,
  RUN_STATUS_LABEL,
  SKIP_REASON_LABEL,
  describeSchedule,
  type RunStatus,
} from "../schema";
import type { AiWorkflowRow, AiWorkflowRunRow } from "../store";
import { WorkflowDialog } from "./workflow-dialog";

const STATUS_ICON: Record<RunStatus, typeof CircleCheck> = {
  queued: CircleDashed,
  running: Loader,
  succeeded: CircleCheck,
  failed: CircleAlert,
  skipped: CircleSlash,
};

function runStatus(value: string): RunStatus {
  return RUN_STATUSES.find((s) => s === value) ?? "queued";
}

/** "Tareas IA": the user's recurring AI tasks and each one's run history. */
export function WorkflowsPage({
  initialWorkflowId,
}: {
  initialWorkflowId?: string;
}) {
  const workflows = useAiWorkflows();
  const [createOpen, setCreateOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(
    initialWorkflowId ?? null,
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ListChecks className="size-5" />
            Tareas IA
          </h1>
          <p className="text-muted-foreground text-sm">
            El asistente las corre solo, con tus permisos de solo lectura, y
            recuerda lo que encontró la vez anterior. También podés pedírselas
            en el chat: “todos los lunes resumime las cobranzas vencidas”.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Nueva tarea
        </Button>
      </header>

      {workflows.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : workflows.isError ? (
        <p className="text-sm">No se pudieron cargar las tareas.</p>
      ) : (workflows.data ?? []).length === 0 ? (
        <div className="text-muted-foreground rounded-lg border p-6 text-sm">
          Todavía no programaste tareas.
        </div>
      ) : (
        <div className="space-y-3">
          {(workflows.data ?? []).map((w) => (
            <WorkflowCard
              key={w.id}
              workflow={w}
              expanded={openId === w.id}
              onToggle={() => setOpenId(openId === w.id ? null : w.id)}
            />
          ))}
        </div>
      )}

      <WorkflowDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function WorkflowCard({
  workflow,
  expanded,
  onToggle,
}: {
  workflow: AiWorkflowRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const setActive = useSetAiWorkflowActive();
  const remove = useDeleteAiWorkflow();

  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold leading-tight">{workflow.title}</p>
          <p className="text-muted-foreground text-xs">
            {describeSchedule(workflow.schedule)} ·{" "}
            {workflow.isActive
              ? `próxima: ${formatArgentineDateTime(workflow.nextRunAt)}`
              : "pausada"}
          </p>
        </div>
        <Switch
          checked={workflow.isActive}
          disabled={setActive.isPending}
          aria-label={workflow.isActive ? "Pausar tarea" : "Reanudar tarea"}
          onCheckedChange={(active) =>
            setActive.mutate(
              { id: workflow.id, active },
              { onError: (err) => toast.error(err.message) },
            )
          }
        />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Borrar tarea">
              <Trash2 className="size-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Borrar la tarea?</AlertDialogTitle>
              <AlertDialogDescription>
                Se borran también sus corridas y su memoria. No se puede
                deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  remove.mutate(workflow.id, {
                    onSuccess: () => toast.success("Tarea borrada."),
                    onError: (err) => toast.error(err.message),
                  })
                }
              >
                Borrar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground line-clamp-3 text-sm">
          {workflow.prompt}
        </p>
        <Button variant="outline" size="sm" onClick={onToggle}>
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              !expanded && "-rotate-90",
            )}
          />
          Corridas
        </Button>
        {expanded && <RunHistory workflowId={workflow.id} />}
      </CardContent>
    </Card>
  );
}

function RunHistory({ workflowId }: { workflowId: string }) {
  const runs = useAiWorkflowRuns(workflowId);
  if (runs.isLoading) return <Skeleton className="h-20 w-full" />;
  if (runs.isError) {
    return <p className="text-sm">No se pudieron cargar las corridas.</p>;
  }
  const rows = runs.data ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Todavía no corrió. La primera corrida aparece acá.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {rows.map((run) => (
        <RunItem key={run.id} run={run} />
      ))}
    </ul>
  );
}

function RunItem({ run }: { run: AiWorkflowRunRow }) {
  const [open, setOpen] = useState(false);
  const status = runStatus(run.status);
  const Icon = STATUS_ICON[status];
  const detail =
    status === "skipped"
      ? (SKIP_REASON_LABEL[run.skipReason ?? ""] ?? run.skipReason)
      : status === "failed"
        ? "No se pudo completar. La próxima corrida lo vuelve a intentar."
        : run.summary;
  return (
    <li className="space-y-2 p-3">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        disabled={!run.output}
      >
        <Icon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {formatArgentineDateTime(run.scheduledFor)} ·{" "}
            {RUN_STATUS_LABEL[status]}
          </p>
          {detail && <p className="text-muted-foreground text-xs">{detail}</p>}
        </div>
        {run.output && (
          <ChevronDown
            className={cn(
              "mt-0.5 size-4 shrink-0 transition-transform",
              !open && "-rotate-90",
            )}
          />
        )}
      </button>
      {open && run.output && (
        <div className="bg-muted/40 rounded-md p-3 text-sm">
          <AiMarkdown body={run.output} />
        </div>
      )}
    </li>
  );
}
