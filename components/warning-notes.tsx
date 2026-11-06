import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

/** Warnings that do not block saving, as a muted notice with an icon (the
 *  house palette has no warning colour). Renders nothing without warnings. */
export function WarningNotes({
  warnings,
  className,
}: {
  warnings: readonly string[];
  className?: string;
}) {
  if (warnings.length === 0) return null;
  return (
    <div
      role="status"
      className={cn(
        "space-y-1 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      {warnings.map((w) => (
        <p key={w} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{w}</span>
        </p>
      ))}
    </div>
  );
}
