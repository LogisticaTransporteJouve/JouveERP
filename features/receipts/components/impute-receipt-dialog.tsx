"use client";

import { ListChecks } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALLOCATION_MODE_LABEL } from "@/lib/allocations";
import { formatMoney, parseArAmount } from "@/lib/format";

import { useAllocateReceipt, useReceiptUnapplied } from "../hooks/use-receipts";
import { AllocationsPicker, type AllocationDraft } from "./allocations-picker";

/** "Imputar": applies what an issued receipt holds a cuenta to open
 *  comprobantes later (FIFO or picked), without editing the receipt. */
export function ImputeReceiptDialog({
  receiptId,
  label,
}: {
  receiptId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"fifo" | "manual">("fifo");
  const [allocations, setAllocations] = useState<AllocationDraft[]>([]);
  const unapplied = useReceiptUnapplied(receiptId, open);
  const allocate = useAllocateReceipt();
  const data = unapplied.data;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setMode("fifo");
      setAllocations([]);
    }
  }

  function onSubmit() {
    if (mode === "manual") {
      if (allocations.some((a) => a.document_type !== "invoice")) {
        toast.error(
          "Un cheque rechazado se cancela editando el recibo, no desde Imputar.",
        );
        return;
      }
      if (allocations.length === 0) {
        toast.error("Elegí al menos un comprobante.");
        return;
      }
    }
    allocate.mutate(
      {
        receipt_id: receiptId,
        mode,
        allocations:
          mode === "manual"
            ? allocations.map((a) => ({
                invoice_id: a.document_id,
                amount_applied: parseArAmount(a.amount_applied) ?? 0,
              }))
            : [],
      },
      {
        onSuccess: (res) => {
          toast.success(
            `Imputado ${formatMoney(res.applied, data?.currency)}.`,
          );
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <IconButton label="Imputar saldo a cuenta" variant="ghost">
          <ListChecks className="size-4" />
        </IconButton>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Imputar recibo {label}</DialogTitle>
          <DialogDescription>
            Aplica lo que el recibo tiene a cuenta a comprobantes pendientes del
            cliente. No cambia las líneas de pago ni los movimientos.
          </DialogDescription>
        </DialogHeader>
        {unapplied.isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Cargando…
          </div>
        ) : unapplied.isError ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {unapplied.error.message}
          </div>
        ) : !data ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Este recibo no tiene saldo a cuenta.
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              Saldo a cuenta:{" "}
              <span className="font-mono font-medium">
                {formatMoney(data.unapplied, data.currency)}
              </span>
            </p>
            <div className="space-y-1">
              <Label htmlFor="impute-mode" className="text-xs">
                Imputación
              </Label>
              <Select
                value={mode}
                onValueChange={(v) =>
                  setMode(v === "manual" ? "manual" : "fifo")
                }
              >
                <SelectTrigger id="impute-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="fifo">
                    {ALLOCATION_MODE_LABEL.fifo}
                  </SelectItem>
                  <SelectItem value="manual">
                    {ALLOCATION_MODE_LABEL.manual}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode === "manual" && (
              <AllocationsPicker
                clientId={data.client_id}
                channelId={data.channel_id}
                allocations={allocations}
                onChange={setAllocations}
              />
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!data || allocate.isPending}
          >
            {allocate.isPending ? "Imputando…" : "Imputar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
