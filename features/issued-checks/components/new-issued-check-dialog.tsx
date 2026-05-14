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
import type { Account } from "@/features/accounts/schema";

import { IssuedCheckForm } from "./issued-check-form";

export function NewIssuedCheckDialog({ accounts }: { accounts: Account[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Cargar cheque
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo cheque propio</DialogTitle>
          <DialogDescription>
            Registrá manualmente un cheque emitido. El movimiento de caja se
            hace por la OP correspondiente.
          </DialogDescription>
        </DialogHeader>
        <IssuedCheckForm
          mode="create"
          accounts={accounts}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
