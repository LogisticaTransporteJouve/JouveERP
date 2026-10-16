"use client";

import { Plus, Trash2 } from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { AiSessionSummary } from "../actions/chat-actions";

type Group = { label: string; sessions: AiSessionSummary[] };

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function groupByDay(sessions: AiSessionSummary[]): Group[] {
  const today = startOfDay(new Date());
  const oneDay = 24 * 60 * 60 * 1000;
  const buckets = new Map<string, AiSessionSummary[]>();
  const order = ["Hoy", "Ayer", "Anteriores"];

  for (const s of sessions) {
    const day = startOfDay(new Date(s.updated_at));
    const label =
      day === today ? "Hoy" : day === today - oneDay ? "Ayer" : "Anteriores";
    const list = buckets.get(label) ?? [];
    list.push(s);
    buckets.set(label, list);
  }

  return order
    .filter((label) => buckets.has(label))
    .map((label) => ({ label, sessions: buckets.get(label) ?? [] }));
}

export function AiHistory({
  sessions,
  isLoading,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  sessions: AiSessionSummary[];
  isLoading: boolean;
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const groups = groupByDay(sessions);

  return (
    <div className="flex h-full flex-col gap-3">
      <Button
        variant="outline"
        size="sm"
        className="justify-start"
        onClick={onNew}
      >
        <Plus className="size-4" />
        Nuevo chat
      </Button>

      <div className="flex-1 space-y-4 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : groups.length === 0 ? (
          <p className="text-muted-foreground px-1 text-xs">
            Todavía no hay conversaciones.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="text-muted-foreground px-1 text-xs font-medium">
                {group.label}
              </p>
              {group.sessions.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-accent",
                    s.id === activeId && "bg-accent",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    className="min-w-0 flex-1 truncate px-2 py-1.5 text-left"
                    title={s.title ?? "Conversación"}
                  >
                    {s.title ?? "Conversación nueva"}
                  </button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                        <span className="sr-only">Borrar conversación</span>
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Borrar conversación</AlertDialogTitle>
                        <AlertDialogDescription>
                          Se elimina la conversación y todos sus mensajes. No se
                          puede deshacer.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onDelete(s.id)}>
                          Borrar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
