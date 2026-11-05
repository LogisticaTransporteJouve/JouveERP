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

import type { Client } from "../schema";
import { ClientForm } from "./client-form";

export function EditClientDialog({ client }: { client: Client }) {
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
          <DialogTitle>{client.legal_name}</DialogTitle>
          <DialogDescription>
            {client.cuit ? `CUIT ${client.cuit}` : "Sin CUIT · interno"}
            {!client.is_active && " · Inactivo"}
          </DialogDescription>
        </DialogHeader>
        <ClientForm
          mode="edit"
          client={client}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
