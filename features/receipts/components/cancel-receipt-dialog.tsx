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

import { useCancelReceipt } from "../hooks/use-receipts";
import { formatReceiptNumber } from "../schema";

export function CancelReceiptDialog({
  receiptId,
  numero,
  puntoVenta,
}: {
  receiptId: string;
  numero: number;
  puntoVenta: number;
}) {
  const [open, setOpen] = useState(false);
  const cancelMut = useCancelReceipt();
  const isPending = cancelMut.isPending;

  function onCancel() {
    cancelMut.mutate(
      { id: receiptId },
      {
        onSuccess: () => {
          toast.success("Recibo anulado.");
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
            Anular recibo {formatReceiptNumber(puntoVenta, numero)}
          </DialogTitle>
          <DialogDescription>
            El recibo queda como anulado pero conserva el número en el
            correlativo. Esta acción no se puede deshacer.
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
            {isPending ? "Anulando…" : "Anular recibo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
