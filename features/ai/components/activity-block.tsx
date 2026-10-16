"use client";

import { AlertTriangle, Check, ChevronDown, Loader2, X } from "lucide-react";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatArgentineDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { ActivityStep } from "../lib/activity";

import { ToolArtifact, toolLabel } from "./tool-renderers";

function headerLabel(steps: readonly ActivityStep[], live: boolean): string {
  const running = steps.findLast((s) => s.status === "running");
  if (live && running) return `Consultando ${toolLabel(running.name)}…`;
  const n = steps.length;
  return `${n} ${n === 1 ? "consulta" : "consultas"}`;
}

/**
 * The turn's tool calls in one collapsible block: what ran, how many rows,
 * from which sources and as of when, and whether the figures are partial.
 * Collapsed unless the user opens it; each step expands to a preview.
 */
export function ActivityBlock({
  steps,
  live,
}: {
  steps: readonly ActivityStep[];
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  const partial = steps.filter((s) => s.partial).length;
  const failed = steps.filter((s) => s.status === "error").length;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="bg-muted/30 w-full max-w-[85%] rounded-md border text-xs"
    >
      <CollapsibleTrigger className="text-muted-foreground hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left">
        {live ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
        ) : (
          <Check className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {headerLabel(steps, live)}
        </span>
        {partial > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            <AlertTriangle className="size-3" />
            {partial === 1 ? "1 parcial" : `${partial} parciales`}
          </span>
        )}
        {failed > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            <X className="size-3" />
            {failed === 1 ? "1 con error" : `${failed} con error`}
          </span>
        )}
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            !open && "-rotate-90",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1 border-t px-3 py-2">
        {steps.map((step) => (
          <ActivityRow key={step.toolCallId} step={step} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ActivityRow({ step }: { step: ActivityStep }) {
  const icon =
    step.status === "running" ? (
      <Loader2 className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
    ) : step.status === "error" ? (
      <X className="size-3 shrink-0" />
    ) : (
      <Check className="size-3 shrink-0" />
    );
  const details = [
    step.status === "error" ? "no se pudo consultar" : null,
    step.rows !== null
      ? `${step.rows.toLocaleString("es-AR")} ${step.rows === 1 ? "fila" : "filas"}`
      : null,
    step.asOf ? `al ${formatArgentineDateTime(step.asOf)}` : null,
    step.partial ? "parcial" : null,
  ].filter((d): d is string => d !== null);

  const summary = (
    <span className="flex min-w-0 items-center gap-2">
      {icon}
      <span className="text-foreground shrink-0">{toolLabel(step.name)}</span>
      <span className="text-muted-foreground truncate">
        {details.join(" · ")}
      </span>
    </span>
  );

  if (step.status !== "done" || step.rows === null) {
    return <div className="py-0.5">{summary}</div>;
  }
  return (
    <details className="group py-0.5">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      <div className="pl-5">
        {step.sources.length > 0 && (
          <p className="text-muted-foreground mt-1 font-mono text-[11px]">
            {step.sources.join(", ")}
          </p>
        )}
        <ToolArtifact toolName={step.name} output={step.output} />
      </div>
    </details>
  );
}
