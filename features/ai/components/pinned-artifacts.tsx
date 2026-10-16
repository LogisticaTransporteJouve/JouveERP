"use client";

import { ArrowLeft, Lock, Pin, PinOff, RefreshCw } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  useAiPinnedView,
  useAiPins,
  useUnpinAiArtifact,
} from "../hooks/use-ai-pins";
import type { AiPinnedArtifact } from "../lib/pinned-artifacts";

import { ArtifactCard } from "./artifact-card";

/** The user's pinned charts and tables, each recomputed on view. */
export function PinnedArtifacts() {
  const { data: pins } = useAiPins();
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <Pin className="size-5" />
        <h1 className="text-2xl font-semibold">Fijados de IA</h1>
        <Button variant="ghost" size="sm" className="ml-auto" asChild>
          <Link href="/ai">
            <ArrowLeft className="size-4" />
            Volver al asistente
          </Link>
        </Button>
      </header>
      <p className="text-muted-foreground text-sm">
        Gráficos y tablas que fijaste desde el asistente. Se recalculan cada vez
        que los abrís, con los datos y los permisos de ese momento.
      </p>
      {pins.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
          Todavía no fijaste nada. En el asistente, usá «Fijar» en un gráfico o
          una tabla.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {pins.map((pin) => (
            <PinnedCard key={pin.id} pin={pin} />
          ))}
        </div>
      )}
    </div>
  );
}

function UnpinButton({ id }: { id: string }) {
  const unpin = useUnpinAiArtifact();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={unpin.isPending}
      onClick={() =>
        unpin.mutate(id, {
          onError: (err) =>
            toast.error(
              err instanceof Error ? err.message : "No se pudo quitar.",
            ),
        })
      }
    >
      <PinOff className="size-3.5" />
      Quitar
    </Button>
  );
}

function PinnedCard({ pin }: { pin: AiPinnedArtifact }) {
  const view = useAiPinnedView(pin.id);
  const refresh = (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      disabled={view.isFetching}
      onClick={() => void view.refetch()}
    >
      <RefreshCw
        className={cn("size-3.5", view.isFetching && "animate-spin")}
      />
      <span className="sr-only">Recalcular</span>
    </Button>
  );

  if (view.isLoading) return <Skeleton className="h-64" />;
  if (view.data?.status === "ok") {
    return (
      <ArtifactCard
        artifact={view.data.artifact}
        control={
          <>
            {refresh}
            <UnpinButton id={pin.id} />
          </>
        }
      />
    );
  }
  const message =
    view.data?.status === "denied"
      ? "Ya no tenés permiso para ver estos datos."
      : view.data?.status === "error"
        ? view.data.message
        : "No se pudo cargar.";
  return (
    <section className="bg-card space-y-2 rounded-lg border p-3">
      <header className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
          {pin.title}
        </h3>
        {view.data?.status !== "denied" && refresh}
        <UnpinButton id={pin.id} />
      </header>
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {view.data?.status === "denied" && <Lock className="size-3.5" />}
        {message}
      </p>
    </section>
  );
}
