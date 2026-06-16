"use client";

import { cn } from "@/lib/utils";

/** Compact token count: 1234 → "1K", 120000 → "120K", 1_500_000 → "1.5M". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export function AiUsageMeter({
  totalTokens,
  cap,
}: {
  totalTokens: number;
  cap: number;
}) {
  const pct = cap > 0 ? Math.min(100, Math.round((totalTokens / cap) * 100)) : 0;
  const atCap = totalTokens >= cap;

  return (
    <div
      className="flex items-center gap-2"
      title={`Consumo de IA hoy: ${totalTokens.toLocaleString(
        "es-AR",
      )} / ${cap.toLocaleString("es-AR")} tokens`}
    >
      <span
        className={cn(
          "text-xs tabular-nums",
          atCap ? "text-foreground font-medium" : "text-muted-foreground",
        )}
      >
        {formatTokens(totalTokens)}/{formatTokens(cap)} hoy
      </span>
      <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
        <div
          className="bg-foreground/60 h-full rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
