"use client";

import { KeyRound, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { syncPhase } from "@/lib/afip/arca-sync-run";
import { strixStatusText } from "@/lib/strix/sync-text";

import { useRequestStrixSync, useStrixStatus } from "../hooks/use-vehicle-km";

import { StrixAccountDialog } from "./strix-account-dialog";

/** The Strix user's state, with «Usuario de Strix» (admin) and «Traer de
 *  Strix» for the range on screen. */
export function StrixBar({
  from,
  to,
  canWrite,
  canAdmin,
}: {
  from: string;
  to: string;
  canWrite: boolean;
  canAdmin: boolean;
}) {
  const status = useStrixStatus();
  const request = useRequestStrixSync();
  const [open, setOpen] = useState(false);
  const s = status.data;
  const busy =
    !!s &&
    ["waiting", "running"].includes(
      syncPhase({ ...s.sync, result: null }, Date.now()),
    );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <p className="text-muted-foreground text-sm">
        {status.isError
          ? status.error.message
          : s
            ? strixStatusText(s, Date.now())
            : "Leyendo Strix…"}
      </p>
      <div className="flex gap-2">
        {canAdmin && s && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <KeyRound className="size-4" />
            Usuario de Strix
          </Button>
        )}
        {canWrite && (
          <Button
            size="sm"
            disabled={!s || s.state !== "ok" || busy || request.isPending}
            onClick={() =>
              request.mutate(
                { from, to },
                {
                  onSuccess: () => toast.success("Pedido a Strix enviado."),
                  onError: (err) => toast.error(err.message),
                },
              )
            }
          >
            <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
            Traer de Strix
          </Button>
        )}
      </div>
      {open && s && (
        <StrixAccountDialog status={s} open={open} onOpenChange={setOpen} />
      )}
    </div>
  );
}
