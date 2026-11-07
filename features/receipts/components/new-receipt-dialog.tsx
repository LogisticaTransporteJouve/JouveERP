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
import { LIST_FORM_DIALOG } from "@/components/form-columns";
import type { Account } from "@/features/accounts/schema";
import type { PickedClient } from "@/features/invoices/components/client-picker";

import { ReceiptForm, type ChannelOption } from "./receipt-form";

export function NewReceiptDialog({
  channels,
  accounts,
  initialClient,
  trigger,
  canEditRetentions,
}: {
  channels: ChannelOption[];
  accounts: Account[];
  /** retentions:write: without it the form offers no retentions editor. */
  canEditRetentions: boolean;
  initialClient?: PickedClient | null;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const isFiscalPage = usePageIsFiscal() !== false;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            {isFiscalPage ? "Nuevo recibo" : "Nuevo recibo interno"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className={LIST_FORM_DIALOG}>
        <DialogHeader>
          <DialogTitle>
            {isFiscalPage ? "Nuevo recibo" : "Nuevo recibo interno"}
          </DialogTitle>
          <DialogDescription>
            El número se asigna automáticamente al canal. Una vez emitido, podés
            editar montos, líneas o anular.
          </DialogDescription>
        </DialogHeader>
        <ReceiptForm
          mode="create"
          channels={channels}
          accounts={accounts}
          canEditRetentions={canEditRetentions}
          initialClient={initialClient ?? null}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
