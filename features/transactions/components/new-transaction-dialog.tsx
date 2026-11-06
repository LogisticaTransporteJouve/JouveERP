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

import { TransactionForm, type ChannelOption } from "./transaction-form";

export function NewTransactionDialog({
  channels,
  canCollect = false,
  canPay = false,
  canEditRetentions = false,
}: {
  channels: ChannelOption[];
  canCollect?: boolean;
  canPay?: boolean;
  canEditRetentions?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Nuevo movimiento
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Nuevo movimiento</DialogTitle>
          <DialogDescription>
            Ingreso, egreso o transferencia entre cuentas. El mes devengado se
            autocompleta con el mes de la fecha.
          </DialogDescription>
        </DialogHeader>
        <TransactionForm
          channels={channels}
          canCollect={canCollect}
          canPay={canPay}
          canEditRetentions={canEditRetentions}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
