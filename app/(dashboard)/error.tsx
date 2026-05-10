"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

// Generic error boundary for the (dashboard) segment. Per-route error.tsx
// files override this with feature-specific copy + selective cache
// eviction. Keep the generic version conservative: it clears the entire
// react-query cache before reset() because we don't know which queries
// failed.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("(dashboard) error boundary caught:", error);
    }
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="rounded-full bg-destructive/10 p-4">
        <AlertCircle className="size-8 text-destructive" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Algo salió mal</h2>
        <p className="text-sm text-muted-foreground">
          No pudimos cargar esta sección. Puede ser un problema temporal de
          red o de Supabase.
        </p>
      </div>
      <Button
        onClick={() => {
          queryClient.clear();
          reset();
        }}
        className="gap-2"
      >
        <RefreshCw className="size-4" />
        Reintentar
      </Button>
    </div>
  );
}
