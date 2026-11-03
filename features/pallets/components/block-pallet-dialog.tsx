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

import { useBlockPallet } from "../hooks/use-pallets";
import type { Pallet } from "../schema";

/** Blocks a pallet: it stays in the warehouse until someone unblocks it. */
export function BlockPalletDialog({
  pallet,
  open,
  onOpenChange,
}: {
  pallet: Pallet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const blockMut = useBlockPallet();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  function submit() {
    blockMut.mutate(
      { id: pallet.id, reason },
      {
        onSuccess: () => {
          toast.success(`Pallet ${pallet.code} bloqueado.`);
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Bloquear pallet {pallet.code}</DialogTitle>
          <DialogDescription>
            Un pallet bloqueado no se despacha ni se borra hasta que se
            desbloquee. Queda registrado quién lo bloqueó y por qué.
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
              placeholder="Mercadería dañada, retenida por el cliente, control de calidad…"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={blockMut.isPending || reason.trim() === ""}
            >
              Bloquear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
