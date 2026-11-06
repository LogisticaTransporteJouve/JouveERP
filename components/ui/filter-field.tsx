import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A labelled control of a filter bar, outside react-hook-form. The label sits
 * on top of its control, like FormItem: a bare inline `<label>` next to an
 * inline-flex picker trigger lands to its left instead.
 */
export function FilterField({
  id,
  label,
  className,
  children,
}: {
  /** The control's id, for the label's `htmlFor`. */
  id: string;
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="filter-field"
      className={cn("grid content-start gap-1.5", className)}
    >
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
