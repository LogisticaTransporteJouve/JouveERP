"use client";

import { Plus } from "lucide-react";
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
import type { PickedSupplier } from "@/features/suppliers/components/supplier-picker";

import { PurchaseInvoiceForm } from "./purchase-invoice-form";

export function NewPurchaseInvoiceDialog({
  initialSupplier,
  trigger,
}: {
  initialSupplier?: PickedSupplier | null;
  trigger?: React.ReactNode;
} = {}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            Cargar factura
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cargar factura de compra</DialogTitle>
          <DialogDescription>
            Cargá manualmente los datos de la factura que te envió el proveedor.
            Para nota de crédito o débito elegí el tipo correspondiente.
          </DialogDescription>
        </DialogHeader>
        <PurchaseInvoiceForm
          mode="create"
          initialSupplier={initialSupplier}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
