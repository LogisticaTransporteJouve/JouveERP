import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// A row of figure tiles: one across on a phone, two from `sm`, four from `xl`.
function StatGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stat-grid"
      className={cn("grid gap-2 sm:grid-cols-2 xl:grid-cols-4", className)}
      {...props}
    />
  );
}

// One figure: a muted label, the figure large, and notes (its split, its
// change) under it. Lines stack from the top so figures line up across a row
// whether or not their tiles carry notes.
function StatTile({
  label,
  href,
  className,
  children,
}: {
  label: string;
  href?: string;
  className?: string;
  children: ReactNode;
}) {
  const classes = cn(
    "@container grid min-w-0 content-start gap-1.5 rounded-lg border bg-card px-4 py-3",
    href && "transition-colors hover:bg-accent/50",
    className,
  );
  const body = (
    <>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      {children}
    </>
  );
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

// The tile's main figure: never cut, it steps down with the tile's width.
function StatValue({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "text-lg font-semibold tracking-tight break-words tabular-nums @[11rem]:text-xl @[15rem]:text-2xl",
        className,
      )}
      {...props}
    />
  );
}

function StatNote({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("text-xs text-muted-foreground tabular-nums", className)}
      {...props}
    />
  );
}

export { StatGrid, StatNote, StatTile, StatValue };
