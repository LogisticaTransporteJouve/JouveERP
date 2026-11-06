"use client";

import * as React from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The reason a save button stays disabled while an edit form is untouched. */
export const NO_CHANGES_REASON = "No hay cambios para guardar.";

/** The first reason whose condition holds, or null when none does. */
export function firstReason(
  ...checks: ReadonlyArray<readonly [boolean, string]>
): string | null {
  return checks.find(([blocked]) => blocked)?.[1] ?? null;
}

/**
 * Explains why a button is disabled. With a `reason` the child is wrapped in a
 * focusable span that shows the reason as a tooltip on hover and keyboard
 * focus (a disabled button gets no pointer or focus events of its own); with
 * no reason the child renders untouched. Pass a reason only while the button
 * is disabled, and only for what blocks it: a pending request needs none.
 */
export function DisabledHint({
  reason,
  children,
  className,
  side,
}: {
  reason: string | null | undefined;
  children: React.ReactNode;
  /** Layout classes for the wrapper (e.g. `ml-auto`, `w-full`). */
  className?: string;
  side?: React.ComponentProps<typeof TooltipContent>["side"];
}) {
  if (!reason) return <>{children}</>;
  // Its own provider lets it render in any tree (tests, isolated renders).
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            data-slot="disabled-hint"
            // The button fills a wrapper its parent stretches, like a dialog
            // footer stacked on a phone.
            className={cn(
              "inline-flex cursor-not-allowed [&>*]:flex-1",
              className,
            )}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent side={side}>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
