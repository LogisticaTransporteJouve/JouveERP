"use client";

import { ListChecks } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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

import {
  useAllocatePaymentOrder,
  usePaymentOrderUnapplied,
} from "../hooks/use-payment-orders";
import { AllocationsPicker, type AllocationDraft } from "./allocations-picker";

/** "Imputar": applies what an issued OP holds a cuenta to open purchase
 *  invoices later (FIFO or picked), without editing the OP. */
export function ImputePaymentOrderDialog({
  paymentOrderId,
  label,
}: {
  paymentOrderId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"fifo" | "manual">("fifo");
  const [allocations, setAllocations] = useState<AllocationDraft[]>([]);
  const unapplied = usePaymentOrderUnapplied(paymentOrderId, open);
  const allocate = useAllocatePaymentOrder();
  const data = unapplied.data;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setMode("fifo");
      setAllocations([]);
    }
  }

  function onSubmit() {
    if (mode === "manual" && allocations.length === 0) {
      toast.error("Elegí al menos una factura.");
      return;
    }
    allocate.mutate(
      {
        payment_order_id: paymentOrderId,
        mode,
        allocations:
          mode === "manual"
            ? allocations.map((a) => ({
                purchase_invoice_id: a.purchase_invoice_id,
                amount_applied: parseArAmount(a.amount_applied) ?? 0,
              }))
            : [],
      },
      {
        onSuccess: (res) => {
          toast.success(`Imputado ${formatMoney(res.applied)}.`);
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Imputar saldo a cuenta"
          title="Imputar saldo a cuenta"
        >
          <ListChecks className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Imputar orden de pago {label}</DialogTitle>
          <DialogDescription>
            Aplica lo que la OP tiene a cuenta a facturas pendientes del
            proveedor. No cambia las líneas de pago ni los movimientos.
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
            Esta orden de pago no tiene saldo a cuenta.
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
              <Label htmlFor="impute-po-mode" className="text-xs">
                Imputación
              </Label>
              <Select
                value={mode}
                onValueChange={(v) =>
                  setMode(v === "manual" ? "manual" : "fifo")
                }
              >
                <SelectTrigger id="impute-po-mode">
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
                supplierId={data.supplier_id}
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
