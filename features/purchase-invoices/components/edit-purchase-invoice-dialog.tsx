"use client";

import { formatCuit } from "@/lib/validation/cuit";
import { Pencil } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  PURCHASE_INVOICE_KIND_LABEL,
  formatInvoiceNumber,
  type PurchaseInvoice,
} from "../schema";
import { PurchaseInvoiceForm } from "./purchase-invoice-form";

export function EditPurchaseInvoiceDialog({
  invoice,
}: {
  invoice: PurchaseInvoice;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <IconButton label="Editar" variant="ghost">
          <Pencil className="size-4" />
        </IconButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[min(90vw,90rem)]">
        <DialogHeader>
          <DialogTitle>
            {PURCHASE_INVOICE_KIND_LABEL[invoice.kind]}{" "}
            {formatInvoiceNumber(invoice)}
          </DialogTitle>
          <DialogDescription>
            {invoice.supplier_legal_name}
            {invoice.supplier_cuit
              ? ` · CUIT ${formatCuit(invoice.supplier_cuit)}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <PurchaseInvoiceForm
          mode="edit"
          invoice={invoice}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
