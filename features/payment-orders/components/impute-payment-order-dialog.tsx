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
import { formatArgentineDate, formatMoney, parseArAmount } from "@/lib/format";

import {
  useAllocatePaymentOrder,
  usePaymentOrderUnapplied,
  useSupplierRejectedChecks,
} from "../hooks/use-payment-orders";
import { AllocationsPicker, type AllocationDraft } from "./allocations-picker";

type ImputeMode = "fifo" | "manual" | "rejected_checks";

function readMode(v: string): ImputeMode {
  return v === "manual" || v === "rejected_checks" ? v : "fifo";
}

/** "Imputar": applies what an issued OP holds a cuenta to open purchase
 *  invoices later (FIFO or picked), or to checks delivered to the supplier
 *  that bounced (oldest first), without editing the OP. */
export function ImputePaymentOrderDialog({
  paymentOrderId,
  label,
}: {
  paymentOrderId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImputeMode>("fifo");
  const [allocations, setAllocations] = useState<AllocationDraft[]>([]);
  const unapplied = usePaymentOrderUnapplied(paymentOrderId, open);
  const allocate = useAllocatePaymentOrder();
  const data = unapplied.data;
  const rejected = useSupplierRejectedChecks(
    data?.supplier_id ?? "",
    data?.channel_id ?? "",
    open && !!data,
  );
  const rejectedChecks = (rejected.data ?? []).filter(
    (c) => c.currency === data?.currency,
  );

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
          <DialogTitle>Imputar orden de pago {label}</DialogTitle>
          <DialogDescription>
            Aplica lo que la OP tiene a cuenta a facturas pendientes del
            proveedor, o a cheques que se le entregaron y fueron rechazados. No
            cambia las líneas de pago ni los movimientos.
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
              <Select value={mode} onValueChange={(v) => setMode(readMode(v))}>
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
                  {rejectedChecks.length > 0 && (
                    <SelectItem value="rejected_checks">
                      Cheques rechazados (los más viejos primero)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            {rejected.isError && (
              <p className="text-sm text-muted-foreground">
                {rejected.error.message}
              </p>
            )}
            {mode === "rejected_checks" && (
              <ul className="space-y-1 text-sm">
                {rejectedChecks.map((c) => (
                  <li
                    key={c.check_id}
                    className="flex flex-wrap justify-between gap-2"
                  >
                    <span>
                      Cheque {c.check_number}
                      {c.check_kind === "issued" ? " (propio)" : ""} · rechazado
                      el {formatArgentineDate(c.rejected_on)}
                    </span>
                    <span className="font-mono">
                      {formatMoney(c.open_amount, c.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
