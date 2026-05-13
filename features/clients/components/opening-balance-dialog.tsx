"use client";

import { Pencil, Wallet } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  useClearClientOpeningBalance,
  useClientOpeningBalance,
  useSetClientOpeningBalance,
} from "../hooks/use-clients";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseAmount(raw: string): number {
  // Acepta "1.234,56" o "1234.56" o "1234". Removemos miles AR ("."),
  // cambiamos coma decimal por punto.
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Dialog para fijar/editar/borrar el saldo de apertura del cliente.
 *
 * Caso de uso: después de migrar facturas históricas que quedan todas
 * pendientes, el usuario fija el saldo real al corte. El sistema imputa
 * FIFO desde la factura más vieja hasta la más nueva con fecha ≤ corte
 * hasta que el remanente coincida con `target_balance`.
 */
export function OpeningBalanceDialog({ clientId }: { clientId: string }) {
  const { data: existing } = useClientOpeningBalance(clientId);
  const [open, setOpen] = useState(false);
  const setMut = useSetClientOpeningBalance();
  const clearMut = useClearClientOpeningBalance();

  const [openingDate, setOpeningDate] = useState(todayIso());
  const [targetRaw, setTargetRaw] = useState("");
  const [notes, setNotes] = useState("");

  // Repoblar el form al abrir si hay opening previo (modo edición).
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setOpeningDate(existing.opening_date);
      setTargetRaw(String(existing.target_balance));
      setNotes(existing.notes ?? "");
    } else {
      setOpeningDate(todayIso());
      setTargetRaw("");
      setNotes("");
    }
  }, [open, existing]);

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
        client_id: clientId,
        opening_date: openingDate,
        target_balance: target,
        notes: notes.trim().length > 0 ? notes.trim() : null,
      },
      {
        onSuccess: () => {
          toast.success(
            existing ? "Saldo de apertura actualizado." : "Saldo de apertura registrado.",
          );
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function onClear() {
    if (!existing) return;
    if (!confirm("¿Borrar el saldo de apertura? Las imputaciones se revierten.")) return;
    clearMut.mutate(clientId, {
      onSuccess: () => {
        toast.success("Saldo de apertura eliminado.");
        setOpen(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  const triggerLabel = existing
    ? "Editar saldo inicial"
    : "Ajustar saldo inicial";
  const TriggerIcon = existing ? Pencil : Wallet;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <TriggerIcon />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Saldo de apertura</DialogTitle>
          <DialogDescription>
            Fijá la deuda real del cliente a una fecha de corte. El sistema
            marca las facturas más viejas como saldadas (FIFO) hasta que el
            remanente coincida.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Fecha de corte</Label>
              <Input
                type="date"
                value={openingDate}
                onChange={(e) => setOpeningDate(e.target.value)}
              />
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
                Corte: {existing.opening_date} · Saldo: ${existing.target_balance.toFixed(2)} ·
                Imputado a facturas: ${existing.total_settled.toFixed(2)}
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
