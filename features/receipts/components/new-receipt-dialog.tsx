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

import { ReceiptForm, type ChannelOption } from "./receipt-form";

export function NewReceiptDialog({
  channels,
  accounts,
}: {
  channels: ChannelOption[];
  accounts: Account[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Nuevo recibo
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nuevo recibo</DialogTitle>
          <DialogDescription>
            El número se asigna automáticamente al canal. Una vez emitido,
            podés editar montos, líneas o anular.
          </DialogDescription>
        </DialogHeader>
        <ReceiptForm
          mode="create"
          channels={channels}
          accounts={accounts}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
