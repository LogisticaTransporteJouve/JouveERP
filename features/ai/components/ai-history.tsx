"use client";

import { ChevronDown, History, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

/**
 * The conversation history as a menu in the page header: «Nuevo chat», the
 * conversations by day, and a trash per conversation. The delete
 * confirmation lives outside the popover, which closes when it opens.
 */
export function AiHistoryMenu({
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
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const groups = groupByDay(sessions);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm">
            <History className="size-4" />
            <span className="hidden sm:inline">Historial</span>
            <ChevronDown className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="flex max-h-[70dvh] w-80 flex-col gap-3 p-3"
        >
          <Button
            variant="outline"
            size="sm"
            className="justify-start"
            onClick={() => {
              setOpen(false);
              onNew();
            }}
          >
            <Plus className="size-4" />
            Nuevo chat
          </Button>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
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
                        onClick={() => {
                          setOpen(false);
                          onSelect(s.id);
                        }}
                        aria-current={s.id === activeId ? "true" : undefined}
                        className="min-w-0 flex-1 truncate px-2 py-1.5 text-left"
                        title={s.title ?? "Conversación"}
                      >
                        {s.title ?? "Conversación nueva"}
                      </button>
                      <IconButton
                        label="Borrar conversación"
                        variant="ghost"
                        className="size-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                        onClick={() => {
                          setOpen(false);
                          setPendingDelete(s.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Borrar conversación</AlertDialogTitle>
            <AlertDialogDescription>
              Se elimina la conversación y todos sus mensajes. No se puede
              deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete);
              }}
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
