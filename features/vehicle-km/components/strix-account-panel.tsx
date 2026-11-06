"use client";

import { KeyRound } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { strixStatusText } from "@/lib/strix/sync-text";

import { useStrixStatus } from "../hooks/use-vehicle-km";

import { StrixAccountDialog } from "./strix-account-dialog";

/** The Strix user the km robot signs in with, in Admin → Accesos. */
export function StrixAccountPanel() {
  const status = useStrixStatus();
  const [open, setOpen] = useState(false);
  const s = status.data;
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 font-medium">
            <KeyRound className="size-4" />
            Usuario de Strix para los km de la flota
          </h2>
          <p className="text-sm text-muted-foreground">
            {status.isError
              ? status.error.message
              : s
                ? strixStatusText(s, Date.now())
                : "Leyendo Strix…"}
            {s?.username ? ` · ${s.username}` : ""}
          </p>
        </div>
        {s && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            {s.state === "missing" ? "Configurar" : "Cambiar"}
          </Button>
        )}
      </div>
      {open && s && (
        <StrixAccountDialog status={s} open={open} onOpenChange={setOpen} />
      )}
    </section>
  );
}
