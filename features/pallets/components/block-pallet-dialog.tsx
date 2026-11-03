"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  useBlockPallet,
  usePalletBlockEvents,
  useUnblockPallet,
} from "../hooks/use-pallets";
import type { Pallet } from "../schema";

/** Blocks a pallet (it stays in the warehouse until someone unblocks it) or
 *  unblocks it; both take a reason, and the dialog shows the history. */
export function BlockPalletDialog({
  pallet,
  mode,
  open,
  onOpenChange,
}: {
  pallet: Pallet;
  mode: "block" | "unblock";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const blockMut = useBlockPallet();
  const unblockMut = useUnblockPallet();
  const history = usePalletBlockEvents(pallet.id, open);
  const [reason, setReason] = useState("");
  const pending = blockMut.isPending || unblockMut.isPending;
  const unblocking = mode === "unblock";

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  function submit() {
    const mut = unblocking ? unblockMut : blockMut;
    mut.mutate(
      { id: pallet.id, reason },
      {
        onSuccess: () => {
          toast.success(
            unblocking
              ? `Pallet ${pallet.code} desbloqueado.`
              : `Pallet ${pallet.code} bloqueado.`,
          );
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {unblocking ? "Desbloquear" : "Bloquear"} pallet {pallet.code}
          </DialogTitle>
          <DialogDescription>
            {unblocking
              ? `Bloqueado por: ${pallet.block_reason ?? "—"}. Vuelve a poder despacharse.`
              : "Un pallet bloqueado no se despacha ni se borra hasta que se desbloquee."}{" "}
            Queda registrado quién lo hizo, cuándo y por qué.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="block-reason">Motivo</Label>
            <Textarea
              id="block-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={
                unblocking
                  ? "Liberado por el cliente, control de calidad aprobado…"
                  : "Mercadería dañada, retenida por el cliente, control de calidad…"
              }
            />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium">Historial de bloqueos</p>
            {history.isLoading ? (
              <p className="text-xs text-muted-foreground">Cargando…</p>
            ) : history.isError ? (
              <p className="text-xs text-muted-foreground">
                No se pudo cargar el historial: {history.error.message}
              </p>
            ) : (history.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Sin bloqueos anteriores.
              </p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                {(history.data ?? []).map((e) => (
                  <li key={e.id}>
                    <span className="font-medium">
                      {e.action === "blocked" ? "Bloqueado" : "Desbloqueado"}
                    </span>{" "}
                    el {new Date(e.created_at).toLocaleString("es-AR")}
                    {e.actor_name ? ` por ${e.actor_name}` : ""}
                    {e.reason ? ` · ${e.reason}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || reason.trim() === ""}>
              {unblocking ? "Desbloquear" : "Bloquear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
