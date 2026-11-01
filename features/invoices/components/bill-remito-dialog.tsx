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
import { IVA_RATE, type IvaRateId, IVA_RATE_OPTIONS } from "@/lib/afip/codes";
import { formatNumber2 } from "@/lib/format";

import { useBillRemito, useEnabledPos } from "../hooks/use-invoices";
import { computeTotals } from "../schema";
import { ClientPicker, type PickedClient } from "./client-picker";

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
  // One key per billing attempt: a retry after a lost response returns the
  // factura already drafted instead of tripping the one-live-factura index.
  const [key] = useState(() => crypto.randomUUID());
  const bill = useBillRemito();

  // Same rule as a new comprobante: the only active fiscal channel and its
  // only enabled POS are taken; several POS → the user picks.
  const { channels } = useScope();
  const fiscalChannels = channels.filter((c) => c.is_fiscal && c.is_active);
  const fiscalChannel = fiscalChannels.length === 1 ? fiscalChannels[0] : null;
  const pos = useEnabledPos(fiscalChannel?.id ?? null, { enabled: open });
  const posOptions = pos.data ?? [];
  const [pickedPos, setPickedPos] = useState<number | null>(null);
  const puntoVenta =
    posOptions.length === 1 ? posOptions[0]!.numero : pickedPos;
  const posProblem = !fiscalChannel
    ? "Configurá un único canal fiscal activo para facturar."
    : pos.isPending
      ? null
      : pos.isError
        ? "No se pudieron cargar los puntos de venta fiscales."
        : posOptions.length === 0
          ? "No hay un punto de venta fiscal habilitado."
          : null;

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
      toast.error(posProblem ?? "Elegí el punto de venta.");
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
            "Factura en cola: con el CAE, el remito se acredita con una nota de crédito interna.",
          );
          setOpen(false);
          router.push(`/invoices/${data.id}`);
        },
        onError: (err) => toast.error(err.message),
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
            remito es el neto y se suma el IVA. Con el CAE, el remito se
            acredita con una nota de crédito interna para no contar la venta dos
            veces. Si estaba cobrado, el recibo interno se anula y el cobro pasa
            a un recibo de Ventas aplicado a la factura: el cliente queda
            debiendo el IVA.
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
                const next = IVA_RATE_OPTIONS.find(
                  (r) => String(r.value) === v,
                );
                if (next) setRate(next.value);
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="IVA">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {IVA_RATE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={String(r.value)}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {posOptions.length > 1 && (
            <div className="space-y-2">
              <Label>Punto de venta</Label>
              <Select
                value={pickedPos === null ? "" : String(pickedPos)}
                onValueChange={(v) => setPickedPos(Number(v))}
              >
                <SelectTrigger
                  className="w-full sm:w-40"
                  aria-label="Punto de venta"
                >
                  <SelectValue placeholder="Elegí uno" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {posOptions.map((p) => (
                    <SelectItem key={p.numero} value={String(p.numero)}>
                      {String(p.numero).padStart(4, "0")}
                      {p.nickname ? ` · ${p.nickname}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {(posProblem ?? (pos.isPending && fiscalChannel)) && (
            <p className="text-sm text-muted-foreground">
              {posProblem ?? "Cargando puntos de venta…"}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 rounded-md border bg-muted/30 p-3 text-sm">
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
          <Button
            onClick={submit}
            disabled={bill.isPending || pos.isPending || posProblem !== null}
          >
            {bill.isPending ? "Emitiendo…" : "Emitir factura"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
