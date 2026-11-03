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
import type { PickedSupplier } from "@/features/suppliers/components/supplier-picker";

import { PaymentOrderForm, type ChannelOption } from "./payment-order-form";

export function NewPaymentOrderDialog({
  channels,
  accounts,
  initialSupplier,
  trigger,
}: {
  channels: ChannelOption[];
  accounts: Account[];
  initialSupplier?: PickedSupplier | null;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            Nueva orden de pago
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nueva orden de pago</DialogTitle>
          <DialogDescription>
            El número se asigna automáticamente al canal. Una vez emitida,
            podés editar montos, imputaciones o anular.
          </DialogDescription>
        </DialogHeader>
        <PaymentOrderForm
          mode="create"
          channels={channels}
          accounts={accounts}
          initialSupplier={initialSupplier ?? null}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
