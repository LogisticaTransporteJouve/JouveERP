"use client";

import { FilePlus2, FileMinus2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DIALOG_STICKY_FOOTER,
} from "@/components/ui/dialog";
import {
  FIT_LIST,
  FIT_LIST_SECTION,
  LIST_FORM,
  LIST_FORM_DIALOG,
  ListFormColumns,
} from "@/components/form-columns";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/money-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CONCEPTO,
  IVA_RATE,
  ivaRatePercent,
  condicionIvaReceptorFor,
  type IvaRateId,
  IVA_RATE_OPTIONS,
} from "@/lib/afip/codes";
import type { IvaCondition } from "@/features/clients/schema";

import {
  amountToInput,
  COTIZACION_DECIMALS,
  formatNumber2,
  parseArAmount,
  todayInAR,
} from "@/lib/format";

import { useIssueFiscalInvoice } from "../hooks/use-invoices";
import { ITEM_DECIMALS, itemInput, itemNumber } from "../lib/item-amounts";
import { computeTotals, NOTES_MAX_LENGTH, type RevenueKind } from "../schema";

export type Kind = "nc" | "nd";

type ItemDraft = {
  description: string;
  quantity: string;
  unit_price: string;
  iva_rate_id: IvaRateId;
  revenue_kind?: RevenueKind;
};

export interface OriginInvoice {
  id: string;
  channel_id: string;
  letter: "A" | "B" | "C";
  punto_venta: number;
  fecha: string;
  concepto: number;
  moneda: string;
  cotizacion: number;
  doc_nro: string; // cuit when doc_tipo=80
  client: {
    id: string;
    legal_name: string;
    iva_condition: IvaCondition;
  };
  items: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    iva_rate_id: number | null;
    revenue_kind?: RevenueKind;
  }>;
}

export const KIND_LABEL: Record<Kind, string> = {
  nc: "Nota de Crédito",
  nd: "Nota de Débito",
};

const KIND_BLURB: Record<Kind, string> = {
  nc: "Anula o ajusta a la baja la factura. Los ítems se prellenan con la factura origen — editá para reflejar el monto que estás acreditando.",
  nd: "Ajusta a la alza la factura. Cargá los ítems del cargo extra (intereses, diferencias, etc.).",
};

/**
 * NcNdForm — the dialog body. No Dialog or Trigger of its own. Reused from
 * IssueNcNdDialog (page /invoices/[id]) and from NewNcNdDialog (page
 * /invoices, after picking an origin).
 */
export function NcNdForm({
  origin,
  kind,
  onSuccess,
  onCancel,
  cancelLabel = "Cancelar",
}: {
  origin: OriginInvoice;
  kind: Kind;
  onSuccess?: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const router = useRouter();
  const issueMut = useIssueFiscalInvoice();
  // One key per note being written: a double submit returns the same draft.
  const [issueKey] = useState(() => crypto.randomUUID());

  const [fecha, setFecha] = useState(() => todayInAR());
  const [motivo, setMotivo] = useState("");
  const [notes, setNotes] = useState("");
  // A note is in its origin's currency; a foreign one takes the cotización of
  // the day, prefilled with the origin's.
  const isForeign = origin.moneda !== "PES";
  const [cotizacion, setCotizacion] = useState(() =>
    amountToInput(origin.cotizacion, COTIZACION_DECIMALS),
  );
  const [items, setItems] = useState<ItemDraft[]>(() =>
    origin.items.length === 0
      ? [
          {
            description: "",
            quantity: "1",
            unit_price: "",
            iva_rate_id: IVA_RATE.TWENTY_ONE,
          },
        ]
      : origin.items.map((it) => ({
          description: it.description,
          quantity: itemInput(it.quantity),
          unit_price: itemInput(it.unit_price),
          iva_rate_id: (it.iva_rate_id ?? IVA_RATE.TWENTY_ONE) as IvaRateId,
          revenue_kind: it.revenue_kind,
        })),
  );

  const totals = computeTotals(
    items.map((it) => ({
      quantity: itemNumber(it.quantity),
      unit_price: itemNumber(it.unit_price),
      iva_rate_id: it.iva_rate_id,
    })),
    true,
  );

  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  }
  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        description: "",
        quantity: "1",
        unit_price: "",
        iva_rate_id: IVA_RATE.TWENTY_ONE,
      },
    ]);
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const isServicios =
    origin.concepto === CONCEPTO.SERVICIOS ||
    origin.concepto === CONCEPTO.PRODUCTOS_Y_SERVICIOS;
  const fchServ = isServicios ? fecha : null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (motivo.trim().length === 0) {
      toast.error("El motivo de la nota es obligatorio.");
      return;
    }
    if (items.some((it) => it.description.trim().length === 0)) {
      toast.error("Cada ítem necesita una descripción.");
      return;
    }
    if (totals.imp_total <= 0) {
      toast.error("El total tiene que ser mayor a cero.");
      return;
    }

    issueMut.mutate(
      {
        channel_id: origin.channel_id,
        client_id: origin.client.id,
        kind,
        // NC/ND keep the same letter and POS as the origin invoice (RG 1415).
        letter: origin.letter,
        punto_venta: origin.punto_venta,
        fecha,
        fch_serv_desde: fchServ,
        fch_serv_hasta: fchServ,
        fch_vto_pago: fchServ,
        concepto: origin.concepto as 1 | 2 | 3,
        doc_tipo: 80,
        doc_nro: origin.doc_nro,
        iva_condition_receptor: condicionIvaReceptorFor(
          origin.client.iva_condition,
        ),
        moneda: isForeign ? "DOL" : "PES",
        cotizacion: isForeign
          ? parseArAmount(cotizacion) || origin.cotizacion
          : 1,
        invoice_origin_id: origin.id,
        motivo_nc_nd: motivo.trim(),
        notes: notes.trim() || null,
        items: items.map((it) => ({
          description: it.description.trim(),
          quantity: itemNumber(it.quantity),
          unit_price: itemNumber(it.unit_price),
          iva_rate_id: it.iva_rate_id,
          // A note on an asset sale adjusts that sale, not services.
          revenue_kind: it.revenue_kind,
        })),
        idempotency_key: issueKey,
      },
      {
        onSuccess: (data) => {
          toast.success(`${KIND_LABEL[kind]} en cola — esperando CAE.`);
          onSuccess?.();
          router.push(`/invoices/${data.id}`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className={LIST_FORM}>
      <ListFormColumns
        left={
          <>
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="text-xs text-muted-foreground">Asociada a</div>
              <div className="font-mono text-sm">
                {origin.letter} {origin.client.legal_name}
              </div>
            </div>

            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[180px_1fr]">
              <div className="space-y-1">
                <Label className="text-xs">Fecha</Label>
                <DatePicker value={fecha} onChange={setFecha} />
              </div>
              {isForeign && (
                <div className="space-y-1">
                  <Label className="text-xs">Cotización {origin.moneda}</Label>
                  <MoneyInput
                    aria-label={`Cotización ${origin.moneda}`}
                    decimals={COTIZACION_DECIMALS}
                    value={cotizacion}
                    onChange={setCotizacion}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Motivo</Label>
                <Input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder={
                    kind === "nc"
                      ? "Ej. devolución de servicios prestados"
                      : "Ej. diferencia de tarifa"
                  }
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="nc-nd-notes" className="text-xs">
                Observaciones (opcional)
              </Label>
              <Textarea
                id="nc-nd-notes"
                rows={2}
                className="min-h-0"
                maxLength={NOTES_MAX_LENGTH}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notas internas; no se envían a AFIP ni van al PDF."
              />
            </div>
          </>
        }
        right={
          <>
            <div className={cn("space-y-2", FIT_LIST_SECTION)}>
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Ítems</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addItem}
                >
                  Agregar ítem
                </Button>
              </div>
              <div className={cn("space-y-2", FIT_LIST)}>
                {items.map((it, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 items-end gap-2 rounded-md border bg-card p-3 sm:grid-cols-[2fr_80px_120px_140px_auto]"
                  >
                    <div className="space-y-1">
                      <Label className="text-xs">Descripción</Label>
                      <Input
                        value={it.description}
                        onChange={(e) =>
                          updateItem(idx, { description: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Cant.</Label>
                      <MoneyInput
                        aria-label="Cantidad"
                        decimals={ITEM_DECIMALS}
                        value={it.quantity}
                        onChange={(quantity) => updateItem(idx, { quantity })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Precio unitario</Label>
                      <MoneyInput
                        aria-label="Precio unitario"
                        decimals={ITEM_DECIMALS}
                        value={it.unit_price}
                        onChange={(unit_price) =>
                          updateItem(idx, { unit_price })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">IVA</Label>
                      <Select
                        value={String(it.iva_rate_id)}
                        onValueChange={(v) =>
                          updateItem(idx, {
                            iva_rate_id: Number(v) as IvaRateId,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {IVA_RATE_OPTIONS.map((r) => (
                            <SelectItem key={r.value} value={String(r.value)}>
                              {ivaRatePercent(r.value)}%
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <IconButton
                      label="Quitar ítem"
                      type="button"
                      variant="ghost"
                      onClick={() => removeItem(idx)}
                      disabledReason={
                        items.length === 1
                          ? "Tiene que quedar al menos un ítem."
                          : null
                      }
                      disabled={items.length === 1}
                    >
                      ×
                    </IconButton>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-3 lg:mt-auto">
              <div>
                <div className="text-xs text-muted-foreground">Neto</div>
                <div className="font-mono">
                  {formatNumber2(totals.imp_neto)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">IVA</div>
                <div className="font-mono">{formatNumber2(totals.imp_iva)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="font-mono font-semibold">
                  {formatNumber2(totals.imp_total)}
                </div>
              </div>
            </div>
          </>
        }
      />

      <div
        className={cn(
          "flex items-center justify-end gap-2",
          DIALOG_STICKY_FOOTER,
        )}
      >
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={issueMut.isPending}
        >
          {cancelLabel}
        </Button>
        <Button type="submit" disabled={issueMut.isPending}>
          {issueMut.isPending
            ? "Emitiendo…"
            : `Emitir ${kind === "nc" ? "NC" : "ND"}`}
        </Button>
      </div>
    </form>
  );
}

export { KIND_BLURB };

/**
 * IssueNcNdDialog — the "origin already known" variant. Used from a
 * voucher's detail page (`/invoices/[id]`) where the origin invoice is the
 * page itself. To issue an NC/ND without going through the detail page, see
 * NewNcNdDialog at `/invoices`.
 */
export function IssueNcNdDialog({
  origin,
  kind,
}: {
  origin: OriginInvoice;
  kind: Kind;
}) {
  const [open, setOpen] = useState(false);
  const Icon = kind === "nc" ? FileMinus2 : FilePlus2;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Icon className="size-4" />
          Emitir {kind === "nc" ? "NC" : "ND"}
        </Button>
      </DialogTrigger>
      <DialogContent className={LIST_FORM_DIALOG}>
        <DialogHeader>
          <DialogTitle>{KIND_LABEL[kind]}</DialogTitle>
          <DialogDescription>{KIND_BLURB[kind]}</DialogDescription>
        </DialogHeader>
        {open && (
          <NcNdForm
            origin={origin}
            kind={kind}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
