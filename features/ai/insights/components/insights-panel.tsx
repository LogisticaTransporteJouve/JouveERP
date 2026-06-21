"use client";

import { ChevronDown, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { InsightCard } from "./insight-card";
import { useInsights, useRunAnalyst } from "../hooks/use-insights";

export function InsightsPanel({
  canManage,
  onAsk,
}: {
  canManage: boolean;
  onAsk: (question: string) => void;
}) {
  const { data: insights = [], isLoading } = useInsights();
  const runAnalyst = useRunAnalyst();
  const [open, setOpen] = useState(true);

  function handleRun() {
    runAnalyst.mutate(undefined, {
      onSuccess: (res) => toast.success(`${res.count} insights recalculados.`),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "No se pudo."),
    });
  }

  if (isLoading) return null;
  if (insights.length === 0 && !canManage) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground flex items-center gap-1 text-sm font-medium hover:text-foreground"
        >
          <Sparkles className="size-4" />
          Insights{insights.length > 0 ? ` (${insights.length})` : ""}
          <ChevronDown
            className={cn("size-4 transition-transform", !open && "-rotate-90")}
          />
        </button>
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={runAnalyst.isPending}
            onClick={handleRun}
          >
            <RefreshCw
              className={cn("size-3.5", runAnalyst.isPending && "animate-spin")}
            />
            Recalcular
          </Button>
        )}
      </div>

      {open &&
        (insights.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No hay insights todavía. Recalculá para generarlos.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {insights.map((insight) => (
              <InsightCard
                key={insight.id}
                insight={insight}
                canManage={canManage}
                onAsk={onAsk}
              />
            ))}
          </div>
        ))}
    </section>
  );
}
