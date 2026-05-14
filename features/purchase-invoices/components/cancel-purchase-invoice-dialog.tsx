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

import { useCancelPurchaseInvoice } from "../hooks/use-purchase-invoices";
import {
  PURCHASE_INVOICE_KIND_LABEL,
  formatInvoiceNumber,
  type PurchaseInvoice,
} from "../schema";

export function CancelPurchaseInvoiceDialog({
  invoice,
}: {
  invoice: PurchaseInvoice;
}) {
  const [open, setOpen] = useState(false);
  const cancelMut = useCancelPurchaseInvoice();

  function onConfirm() {
    cancelMut.mutate(invoice.id, {
      onSuccess: () => {
        toast.success("Factura anulada.");
        setOpen(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Anular"
          className="text-destructive hover:text-destructive"
          disabled={invoice.status === "cancelled"}
        >
          <Ban className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anular factura</DialogTitle>
          <DialogDescription>
            {PURCHASE_INVOICE_KIND_LABEL[invoice.kind]}{" "}
            {formatInvoiceNumber(invoice)} · {invoice.supplier_legal_name}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm">
          La factura queda marcada como anulada y deja de contar para los
          balances y aging. La acción se puede revertir editando la factura.
        </p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={cancelMut.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
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
