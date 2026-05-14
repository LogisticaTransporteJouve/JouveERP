"use client";

import { Ban } from "lucide-react";
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

import { useCancelPaymentOrder } from "../hooks/use-payment-orders";
import { formatPaymentOrderNumber } from "../schema";

export function CancelPaymentOrderDialog({
  paymentOrderId,
  numero,
  puntoVenta,
}: {
  paymentOrderId: string;
  numero: number;
  puntoVenta: number;
}) {
  const [open, setOpen] = useState(false);
  const cancelMut = useCancelPaymentOrder();
  const isPending = cancelMut.isPending;

  function onCancel() {
    cancelMut.mutate(
      { id: paymentOrderId },
      {
        onSuccess: () => {
          toast.success("Orden de pago anulada.");
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Anular">
          <Ban className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Anular OP {formatPaymentOrderNumber(puntoVenta, numero)}
          </DialogTitle>
          <DialogDescription>
            La OP queda como anulada pero conserva el número en el correlativo.
            Las transactions generadas se borran automáticamente. Esta acción no
            se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onCancel}
            disabled={isPending}
          >
            {isPending ? "Anulando…" : "Anular OP"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
