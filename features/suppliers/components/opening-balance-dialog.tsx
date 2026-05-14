"use client";

import { Pencil, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { todayIsoLocal as todayIso } from "@/lib/date-range";

import {
  useClearSupplierOpeningBalance,
  useSetSupplierOpeningBalance,
  useSupplierOpeningBalance,
} from "../hooks/use-suppliers";

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/\s/g, "").replace(/\./g, "").replace(/,/g, ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function SupplierOpeningBalanceDialog({
  supplierId,
  prefill = false,
  trigger,
}: {
  supplierId: string;
  prefill?: boolean;
  trigger?: React.ReactNode;
}) {
  const { data: existing } = useSupplierOpeningBalance(supplierId);
  const [open, setOpen] = useState(false);
  const setMut = useSetSupplierOpeningBalance();
  const clearMut = useClearSupplierOpeningBalance();

  const [openingDate, setOpeningDate] = useState(todayIso());
  const [targetRaw, setTargetRaw] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    if (prefill && existing) {
      setOpeningDate(existing.opening_date);
      setTargetRaw(String(existing.target_balance));
      setNotes(existing.notes ?? "");
    } else {
      setOpeningDate(todayIso());
      setTargetRaw("");
      setNotes("");
    }
  }, [open, prefill, existing]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const target = parseAmount(targetRaw);
    if (!Number.isFinite(target) || target < 0) {
      toast.error("Ingresá un saldo válido (no negativo).");
      return;
    }
    if (!openingDate) {
      toast.error("Ingresá la fecha de corte.");
      return;
    }
    setMut.mutate(
      {
        supplier_id: supplierId,
        opening_date: openingDate,
        target_balance: target,
        notes: notes.trim().length > 0 ? notes.trim() : null,
      },
      {
        onSuccess: () => {
          toast.success(
            existing
              ? "Ajuste de saldo actualizado."
              : "Ajuste de saldo registrado.",
          );
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function onClear() {
    if (!existing) return;
    if (!confirm("¿Borrar el ajuste de saldo? Las imputaciones se revierten."))
      return;
    clearMut.mutate(supplierId, {
      onSuccess: () => {
        toast.success("Ajuste de saldo eliminado.");
        setOpen(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  const TriggerIcon = existing ? Pencil : Wallet;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <TriggerIcon />
            Ajustar saldo
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajustar saldo</DialogTitle>
          <DialogDescription>
            Fijá la deuda real con el proveedor a una fecha. El sistema
            reconcilia el saldo al valor ingresado e imputa FIFO contra las
            facturas anteriores. Editable: re-correr sobrescribe.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Fecha de corte</Label>
              <DatePicker value={openingDate} onChange={setOpeningDate} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Saldo real al corte ($)</Label>
              <Input
                inputMode="decimal"
                placeholder="0,00"
                value={targetRaw}
                onChange={(e) => setTargetRaw(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notas (opcional)</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. saldo conciliado al 31/12 según planilla legacy."
            />
          </div>

          {existing && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <p className="font-medium">Registrado actualmente</p>
              <p className="font-mono">
                Corte: {existing.opening_date} · Saldo: $
                {existing.target_balance.toFixed(2)} · Imputado a facturas: $
                {existing.total_settled.toFixed(2)}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              {existing && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClear}
                  disabled={clearMut.isPending || setMut.isPending}
                >
                  Borrar
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={setMut.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={setMut.isPending}>
                {setMut.isPending
                  ? "Guardando…"
                  : existing
                    ? "Actualizar"
                    : "Registrar"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
