"use client";

import { cn } from "@/lib/utils";

import { aiSpendView, type AiSpendToday } from "../lib/usage-money";

export function AiUsageMeter(props: AiSpendToday) {
  const view = aiSpendView(props);
  return (
    <div className="flex items-center gap-2" title={view.tooltip}>
      <span
        className={cn(
          "text-xs tabular-nums",
          view.atCap ? "text-foreground font-medium" : "text-muted-foreground",
        )}
      >
        {view.spent} de {view.cap} hoy
      </span>
      <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
        <div
          className="bg-foreground/60 h-full rounded-full"
          style={{ width: `${view.pct}%` }}
        />
      </div>
    </div>
  );
}
