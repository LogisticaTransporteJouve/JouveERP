"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
        <Button variant="ghost" size="icon" aria-label="Editar">
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {PURCHASE_INVOICE_KIND_LABEL[invoice.kind]}{" "}
            {formatInvoiceNumber(invoice)}
          </DialogTitle>
          <DialogDescription>
            {invoice.supplier_legal_name}
            {invoice.supplier_cuit ? ` · CUIT ${invoice.supplier_cuit}` : ""}
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
