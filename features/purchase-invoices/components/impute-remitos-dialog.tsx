"use client";

import { Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  SupplierPicker,
  type PickedSupplier,
} from "@/features/suppliers/components/supplier-picker";
import { formatArgentineDate, formatNumber2 } from "@/lib/format";

import {
  useImputableRemitos,
  useImputePurchaseRemitos,
} from "../hooks/use-purchase-invoices";

/**
 * "Imputar remitos internos" on a fiscal purchase factura: the remitos of an
 * Otras compras supplier that this factura bills are credited with a nota de
 * crédito interna, and what was paid on them passes to the factura.
 */
export function ImputeRemitosDialog({
  facturaId,
  facturaLabel,
  available,
}: {
  facturaId: string;
  facturaLabel: string;
  /** The factura's total less the remitos already imputed to it. */
  available: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const remitos = useImputableRemitos(supplier?.id ?? null, { enabled: open });
  const impute = useImputePurchaseRemitos();

  const rows = remitos.data ?? [];
  const chosen = rows.filter((r) => picked.has(r.id));
  const total = chosen.reduce((acc, r) => acc + r.imp_total, 0);
  const paid = chosen.reduce((acc, r) => acc + r.paid, 0);
  const overFactura = total > available + 0.01;

  function pickSupplier(next: PickedSupplier | null) {
    setSupplier(next);
    setPicked(new Set());
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) pickSupplier(null);
  }

  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function submit() {
    impute.mutate(
      { factura_id: facturaId, remito_ids: chosen.map((r) => r.id) },
      {
        onSuccess: () => {
          toast.success(
            chosen.length === 1 ? "Remito imputado." : "Remitos imputados.",
          );
          onOpenChange(false);
          router.refresh();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 />
          Imputar remitos internos
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Imputar remitos a {facturaLabel}</DialogTitle>
          <DialogDescription>
            Cada remito de Otras compras que esta factura incluye se cancela con
            una nota de crédito interna, para no contar la compra dos veces. Si
            estaba pagado, la orden de pago interna se anula y el pago pasa a
            una orden de pago de Compras aplicada a esta factura.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Proveedor de Otras compras</Label>
            <SupplierPicker
              value={supplier}
              onChange={pickSupplier}
              isFiscal={false}
            />
          </div>

          {supplier && (
            <div className="space-y-2">
              <Label>Remitos</Label>
              {remitos.isPending ? (
                <p className="text-sm text-muted-foreground">
                  Cargando remitos…
                </p>
              ) : remitos.isError ? (
                <p className="text-sm text-muted-foreground">
                  No se pudieron cargar los remitos.
                </p>
              ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Este proveedor no tiene remitos para imputar.
                </p>
              ) : (
                <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
                  {rows.map((r) => (
                    <li key={r.id} className="px-3 py-2 text-sm">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          id={`remito-${r.id}`}
                          checked={picked.has(r.id)}
                          disabled={r.blocker !== null}
                          onCheckedChange={(v) => toggle(r.id, v === true)}
                        />
                        <label
                          htmlFor={`remito-${r.id}`}
                          className="flex flex-1 cursor-pointer flex-wrap items-center gap-x-3"
                        >
                          <span className="font-mono">{r.label}</span>
                          <span className="text-muted-foreground">
                            {formatArgentineDate(r.fecha)}
                          </span>
                          {r.paid > 0 && (
                            <span className="text-xs text-muted-foreground">
                              pagado ${formatNumber2(r.paid)}
                            </span>
                          )}
                          <span className="ml-auto font-mono">
                            ${formatNumber2(r.imp_total)}
                          </span>
                        </label>
                      </div>
                      {r.blocker && (
                        <p className="mt-1 pl-7 text-xs text-muted-foreground">
                          {r.blocker}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {chosen.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 rounded-md border bg-muted/30 p-3 text-sm">
              <span>
                Remitos:{" "}
                <span className="font-mono">${formatNumber2(total)}</span>
              </span>
              {paid > 0 && (
                <span>
                  Pago que pasa:{" "}
                  <span className="font-mono">${formatNumber2(paid)}</span>
                </span>
              )}
              <span className="font-semibold">
                Disponible en la factura:{" "}
                <span className="font-mono">${formatNumber2(available)}</span>
              </span>
            </div>
          )}
          {overFactura && (
            <p className="text-sm text-muted-foreground">
              Los remitos suman más que lo disponible en la factura: revisá
              cuáles imputar.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={impute.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={impute.isPending || chosen.length === 0 || overFactura}
          >
            {impute.isPending ? "Imputando…" : "Imputar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
