"use client";

import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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

import { useReceiptDetail } from "../hooks/use-receipts";
import { formatReceiptNumber } from "../schema";
import { ReceiptForm, type ChannelOption } from "./receipt-form";

export function EditReceiptDialog({
  receiptId,
  numero,
  puntoVenta,
  channels,
  accounts,
}: {
  receiptId: string;
  numero: number;
  puntoVenta: number;
  channels: ChannelOption[];
  accounts: Account[];
}) {
  const [open, setOpen] = useState(false);
  const detailQuery = useReceiptDetail(receiptId, { enabled: open });
  const detail = detailQuery.data;
  const loading = detailQuery.isLoading;

  useEffect(() => {
    if (detailQuery.error) {
      toast.error(detailQuery.error.message);
      setOpen(false);
    }
  }, [detailQuery.error]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Editar">
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Recibo {formatReceiptNumber(puntoVenta, numero)}
          </DialogTitle>
          <DialogDescription>
            Editá montos, líneas o imputaciones. El número y el canal son
            inmutables.
          </DialogDescription>
        </DialogHeader>
        {loading || !detail ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Cargando…
          </div>
        ) : (
          <ReceiptForm
            mode="edit"
            channels={channels}
            accounts={accounts}
            receipt={detail}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
