"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { verifyCuitAction, type VerifyCuitResult } from "../actions/afip-actions";

export function PadronLookup() {
  const [cuit, setCuit] = useState("");
  const [result, setResult] = useState<VerifyCuitResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await verifyCuitAction({ cuit });
      setResult(res);
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="flex items-end gap-3">
        <div className="flex-1 space-y-2">
          <Label htmlFor="cuit">CUIT</Label>
          <Input
            id="cuit"
            value={cuit}
            onChange={(e) => setCuit(e.target.value)}
            placeholder="30-71463743-2"
            disabled={isPending}
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={isPending || cuit.trim().length === 0}>
          {isPending ? "Consultando…" : "Consultar"}
        </Button>
      </form>

      {result && !result.ok && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-medium">Error</p>
          <p>{result.error}</p>
          {result.retryAfterSeconds !== undefined && (
            <p className="mt-1 text-xs">
              Reintentar en {result.retryAfterSeconds}s.
            </p>
          )}
        </div>
      )}

      {result?.ok && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {result.fromCache && (
              <span className="rounded-full bg-muted px-2 py-0.5">
                cache
              </span>
            )}
            {result.stale && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground dark:text-muted-foreground">
                stale (AFIP no disponible)
              </span>
            )}
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted/30 p-4 text-xs">
            {JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
