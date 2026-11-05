"use client";

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

import type { Supplier } from "../schema";
import { SupplierForm } from "./supplier-form";

export function EditSupplierDialog({ supplier }: { supplier: Supplier }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <IconButton label="Editar" variant="ghost">
          <Pencil className="size-4" />
        </IconButton>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{supplier.legal_name}</DialogTitle>
          <DialogDescription>
            {supplier.cuit ? `CUIT ${supplier.cuit}` : "Sin CUIT · interno"}
            {!supplier.is_active && " · Inactivo"}
          </DialogDescription>
        </DialogHeader>
        <SupplierForm
          mode="edit"
          supplier={supplier}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
