"use client";

import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useScope } from "@/components/providers/scope-provider";
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
import { IVA_RATE, type IvaRateId } from "@/lib/afip/codes";
import { formatNumber2 } from "@/lib/format";

import { useBillRemito, useEnabledPos } from "../hooks/use-invoices";
import { computeTotals } from "../schema";
import { ClientPicker, type PickedClient } from "./client-picker";

const RATE_OPTIONS: Array<{ value: IvaRateId; label: string }> = [
  { value: IVA_RATE.TWENTY_ONE, label: "21%" },
  { value: IVA_RATE.TEN_FIVE, label: "10.5%" },
  { value: IVA_RATE.TWENTY_SEVEN, label: "27%" },
  { value: IVA_RATE.FIVE, label: "5%" },
  { value: IVA_RATE.TWO_FIVE, label: "2.5%" },
  { value: IVA_RATE.ZERO, label: "0%" },
];

/**
 * "Facturar" on a remito interno: a fiscal factura to a Ventas client with
 * the remito's items, its price as the net plus IVA. When AFIP authorizes it,
 * the remito is credited with a nota de crédito interna.
 */
export function BillRemitoDialog({
  remitoId,
  remitoLabel,
  items,
}: {
  remitoId: string;
  remitoLabel: string;
  items: Array<{ quantity: number; unit_price: number }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState<PickedClient | null>(null);
  const [rate, setRate] = useState<IvaRateId>(IVA_RATE.TWENTY_ONE);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const bill = useBillRemito();

  const { channels } = useScope();
  const fiscalChannel = channels.find((c) => c.is_fiscal && c.is_active);
  const pos = useEnabledPos(fiscalChannel?.id ?? null, { enabled: open });
  const puntoVenta = pos.data?.[0]?.numero ?? null;

  const totals = useMemo(
    () =>
      computeTotals(
        items.map((it) => ({ ...it, iva_rate_id: rate })),
        true,
      ),
    [items, rate],
  );

  function submit() {
    if (!client) {
      toast.error("Elegí el cliente de Ventas.");
      return;
    }
    if (!fiscalChannel || puntoVenta === null) {
      toast.error("No hay un punto de venta fiscal habilitado.");
      return;
    }
    bill.mutate(
      {
        remito_id: remitoId,
        client_id: client.id,
        channel_id: fiscalChannel.id,
        punto_venta: puntoVenta,
        iva_rate_id: rate,
        idempotency_key: key,
      },
      {
        onSuccess: (data) => {
          toast.success(
            "Factura en cola: cuando AFIP dé el CAE se anula el remito con una nota de crédito interna.",
          );
          setOpen(false);
          router.push(`/invoices/${data.id}`);
        },
        onError: (err) => {
          toast.error(err.message);
          setKey(crypto.randomUUID());
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText />
          Facturar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Facturar {remitoLabel}</DialogTitle>
          <DialogDescription>
            Se emite una factura en Ventas con los mismos ítems: el precio del
            remito es el neto y se suma el IVA. Con el CAE, el remito se anula
            con una nota de crédito interna para no contar la venta dos veces.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Cliente de Ventas</Label>
            <ClientPicker value={client} onChange={setClient} isFiscal />
          </div>
          <div className="space-y-2">
            <Label>IVA</Label>
            <Select
              value={String(rate)}
              onValueChange={(v) => {
                const next = RATE_OPTIONS.find((r) => String(r.value) === v);
                if (next) setRate(next.value);
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="IVA">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {RATE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={String(r.value)}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-end gap-6 rounded-md border bg-muted/30 p-3 text-sm">
            <span>
              Neto:{" "}
              <span className="font-mono">
                ${formatNumber2(totals.imp_neto)}
              </span>
            </span>
            <span>
              IVA:{" "}
              <span className="font-mono">
                ${formatNumber2(totals.imp_iva)}
              </span>
            </span>
            <span className="text-base font-semibold">
              Total:{" "}
              <span className="font-mono">
                ${formatNumber2(totals.imp_total)}
              </span>
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={bill.isPending}
          >
            Cancelar
          </Button>
          <Button onClick={submit} disabled={bill.isPending}>
            {bill.isPending ? "Emitiendo…" : "Emitir factura"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
