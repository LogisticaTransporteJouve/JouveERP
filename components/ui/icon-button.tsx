"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type IconButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "size" | "aria-label" | "title"
> & {
  /** What the button does, in Spanish: the tooltip and the accessible name. */
  label: string;
  size?: "icon" | "icon-xs" | "icon-sm" | "icon-lg";
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
};

/**
 * A button whose only content is an icon. The label is required so every such
 * button says what it does on hover and focus, and to screen readers.
 */
function IconButton({
  label,
  size = "icon",
  tooltipSide,
  disabled,
  ...props
}: IconButtonProps) {
  const button = (
    <Button size={size} aria-label={label} disabled={disabled} {...props} />
  );

  // Its own provider lets it render in any tree (tests, isolated renders)
  // without relying on the one in the root layout.
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {disabled ? (
            // A disabled button gets no pointer or focus events, so the wrapper
            // carries the tooltip.
            <span tabIndex={0} className="inline-flex cursor-not-allowed">
              {button}
            </span>
          ) : (
            button
          )}
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { IconButton };
export type { IconButtonProps };
