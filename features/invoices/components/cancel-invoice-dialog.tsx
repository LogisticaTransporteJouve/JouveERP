"use client";

import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { useCancelInvoice } from "../hooks/use-invoices";

/** Cancels an internal (non-fiscal) invoice. */
export function CancelInvoiceDialog({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const cancelMut = useCancelInvoice();

  function onConfirm() {
    cancelMut.mutate(id, {
      onSuccess: () => {
        toast.success("Comprobante anulado.");
        setOpen(false);
        router.refresh();
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Ban />
          Anular
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anular comprobante</DialogTitle>
          <DialogDescription>{label}</DialogDescription>
        </DialogHeader>

        <p className="text-sm">
          El comprobante queda anulado y deja de contar para la cuenta corriente
          y el aging. Si facturaba un flete o un período de almacenaje, ese
          flete o período vuelve a quedar para facturar. La anulación no se
          puede deshacer.
        </p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={cancelMut.isPending}
          >
            Volver
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={cancelMut.isPending}
          >
            {cancelMut.isPending ? "Anulando…" : "Anular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
