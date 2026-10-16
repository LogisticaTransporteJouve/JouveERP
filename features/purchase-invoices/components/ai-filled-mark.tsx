"use client";

import { Sparkles } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Subtle marker next to a label whose value was read from the document. */
export function AiFilledMark() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-muted-foreground ml-1 inline-flex align-middle">
          <Sparkles className="size-3" aria-hidden />
          <span className="sr-only">Completado por IA</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>Completado por IA</TooltipContent>
    </Tooltip>
  );
}
