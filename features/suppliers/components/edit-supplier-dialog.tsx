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

import type { Supplier } from "../schema";
import { SupplierForm } from "./supplier-form";

export function EditSupplierDialog({ supplier }: { supplier: Supplier }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Editar">
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{supplier.legal_name}</DialogTitle>
          <DialogDescription>
            CUIT {supplier.cuit}
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
