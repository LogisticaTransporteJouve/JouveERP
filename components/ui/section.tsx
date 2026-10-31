import type { LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// A flat block of a page: a small heading with an optional icon and a short
// description, its actions on the same row, and the content below bringing
// its own surface (a table, a chart) when it has one.
function Section({
  title,
  icon: Icon,
  description,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      data-slot="section"
      aria-labelledby={id}
      className={cn("grid gap-3", className)}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="grid gap-0.5">
          <h2 id={id} className="flex items-center gap-2 text-sm font-semibold">
            {Icon && (
              <Icon aria-hidden className="size-4 text-muted-foreground" />
            )}
            {title}
          </h2>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {actions}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

export { Section };
