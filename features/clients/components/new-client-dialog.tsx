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

import { ClientForm } from "./client-form";

export function NewClientDialog() {
  const [open, setOpen] = useState(false);
  const isFiscal = usePageIsFiscal() ?? true;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Nuevo cliente
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
          <DialogDescription>
            {isFiscal
              ? "Ingresá el CUIT y verificá AFIP para autocompletar los datos."
              : "Cliente de Otras ventas: sin CUIT ni AFIP."}
          </DialogDescription>
        </DialogHeader>
        <ClientForm
          mode="create"
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
