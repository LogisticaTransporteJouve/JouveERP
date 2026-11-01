"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { usePageIsFiscal } from "@/components/providers/scope-provider";
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

import type { PurchaseInvoiceDraft } from "../lib/purchase-invoice-draft";
import { usePurchaseInvoiceFileAssist } from "./file-assist-context";
import { PurchaseInvoiceDraftDialogContent } from "./purchase-invoice-draft-dialog";
import { PurchaseInvoiceForm } from "./purchase-invoice-form";

export function NewPurchaseInvoiceDialog({
  initialSupplier,
  trigger,
}: {
  initialSupplier?: PickedSupplier | null;
  trigger?: React.ReactNode;
} = {}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PurchaseInvoiceDraft | null>(null);
  const fileAssist = usePurchaseInvoiceFileAssist();
  const isInternal = usePageIsFiscal() === false;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setDraft(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            {isInternal ? "Cargar remito" : "Cargar factura"}
          </Button>
        )}
      </DialogTrigger>
      {draft ? (
        <PurchaseInvoiceDraftDialogContent
          draft={draft}
          onCreated={() => onOpenChange(false)}
          onClose={() => onOpenChange(false)}
        />
      ) : (
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Cargar factura de compra</DialogTitle>
            <DialogDescription>
              Cargá los datos de la factura que te envió el proveedor
              {fileAssist ? " o completalos desde el PDF o una foto" : ""}. Para
              nota de crédito o débito elegí el tipo correspondiente.
            </DialogDescription>
          </DialogHeader>
          {fileAssist?.(setDraft)}
          <PurchaseInvoiceForm
            mode="create"
            initialSupplier={initialSupplier}
            onSuccess={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}
