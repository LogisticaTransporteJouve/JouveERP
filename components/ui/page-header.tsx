import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// The title row of a list or settings screen: the h1 and its description on
// the left, the page's buttons on the right. On a phone the buttons drop
// below the title and wrap among themselves, so a long button row never
// pushes the page sideways; from `sm` up the row stays on one line, as it
// always was.
function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Alignment override, e.g. `items-end`. */
  className?: string;
}) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight break-words">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div
          data-slot="page-header-actions"
          className="flex flex-wrap items-center gap-2 sm:shrink-0"
        >
          {actions}
        </div>
      )}
    </div>
  );
}

export { PageHeader };
