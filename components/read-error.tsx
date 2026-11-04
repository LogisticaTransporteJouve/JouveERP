"use client";

import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A read that failed, in place of its empty state: what could not be read
 *  and «Reintentar». */
export function ReadError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-2 text-sm text-muted-foreground",
        className,
      )}
    >
      <span>{message}</span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RotateCw />
        Reintentar
      </Button>
    </div>
  );
}
