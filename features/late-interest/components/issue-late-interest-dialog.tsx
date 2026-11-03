"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatArgentineDate, formatMoney } from "@/lib/format";
import { paymentCurrencyOf } from "@/lib/fx";

import { PosSelect } from "@/features/invoices/components/pos-select";

import { useIssueLateInterestNd } from "../hooks/use-late-interest";
import { comprobanteLabel, computeLateInterest } from "../lib/late-interest";
import type { LateInterestCandidate } from "../schema";

/** "Generar ND": confirms the period, the rate and the punto de venta of the
 *  ND for one overdue comprobante. */
export function IssueLateInterestDialog({
  candidate,
  asOf,
  onClose,
}: {
  candidate: LateInterestCandidate | null;
  asOf: string;
  onClose: () => void;
}) {
  const open = candidate !== null;
  const issueMut = useIssueLateInterestNd();
  const [rate, setRate] = useState("");
  const [puntoVenta, setPuntoVenta] = useState("");

  useEffect(() => {
    if (!candidate) return;
    setRate(
      candidate.monthly_rate === null ? "" : String(candidate.monthly_rate),
    );
    setPuntoVenta(String(candidate.punto_venta));
  }, [candidate]);

  const rateNumber = Number(rate.replace(",", "."));
  const preview =
    candidate && Number.isFinite(rateNumber) && rateNumber > 0
      ? computeLateInterest({
          balanceDays: candidate.balance_days,
          monthlyRate: rateNumber,
          from: candidate.charge_from,
          to: asOf,
        })
      : null;
  const currency = paymentCurrencyOf(candidate?.moneda);

  function onSubmit() {
    if (!candidate) return;
    if (!preview || preview.interest <= 0) {
      toast.error("Ingresá una tasa mayor a 0.");
      return;
    }
    if (puntoVenta === "") {
      toast.error("Elegí un punto de venta.");
      return;
    }
    issueMut.mutate(
      {
        invoice_id: candidate.invoice_id,
        as_of: asOf,
        monthly_rate: rateNumber,
        punto_venta: Number(puntoVenta),
      },
      {
        onSuccess: () => {
          toast.success("Nota de débito por intereses creada.");
          onClose();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generar nota de débito por mora</DialogTitle>
          <DialogDescription>
            Interés simple sobre el saldo abierto, a la tasa mensual prorrateada
            por día. El período queda cobrado: no se vuelve a cobrar mientras la
            nota esté vigente.
            {candidate?.channel_is_fiscal ? " Lleva IVA 21%." : ""}
          </DialogDescription>
        </DialogHeader>
        {candidate && (
          <div className="space-y-4">
            <dl className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
              <Row label="Cliente" value={candidate.client_name} />
              <Row label="Comprobante" value={comprobanteLabel(candidate)} />
              <Row
                label="Saldo abierto"
                value={formatMoney(candidate.open_amount, currency)}
              />
              <Row
                label="Período"
                value={`${formatArgentineDate(candidate.charge_from)} al ${formatArgentineDate(asOf)} (${preview?.days ?? candidate.days} días)`}
              />
              <Row
                label="Interés (neto)"
                value={preview ? formatMoney(preview.interest, currency) : "—"}
              />
            </dl>
            <div className="space-y-2">
              <Label htmlFor="li-rate">Tasa mensual (%)</Label>
              <Input
                id="li-rate"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                inputMode="decimal"
                placeholder="Ej.: 3"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="li-pos">Punto de venta</Label>
              <PosSelect
                id="li-pos"
                channelId={candidate.channel_id}
                value={puntoVenta}
                onChange={setPuntoVenta}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={issueMut.isPending || !preview || preview.interest <= 0}
            onClick={onSubmit}
          >
            Generar ND
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}
