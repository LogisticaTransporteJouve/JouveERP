"use client";

import { Ban } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
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
        <IconButton
          label="Anular"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={invoice.status === "cancelled"}
        >
          <Ban className="size-4" />
        </IconButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anular factura</DialogTitle>
          <DialogDescription>
            {PURCHASE_INVOICE_KIND_LABEL[invoice.kind]}{" "}
            {formatInvoiceNumber(invoice)} · {invoice.supplier_legal_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <p>
            La factura queda anulada: sale del saldo del proveedor, de la deuda
            y del Libro IVA Compras, y su asiento se revierte. No se puede
            deshacer.
          </p>
          <p className="text-muted-foreground">
            No se puede anular si tiene órdenes de pago imputadas, notas de
            crédito o débito cargadas, o si quedó saldada por el ajuste de saldo
            del proveedor. En esos casos corresponde una nota de crédito.
          </p>
        </div>

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
