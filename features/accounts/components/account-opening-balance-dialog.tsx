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
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { todayIsoLocal as todayIso } from "@/lib/date-range";

import {
  useAccountOpeningBalance,
  useClearAccountOpeningBalance,
  useSetAccountOpeningBalance,
} from "../hooks/use-accounts";

interface ChannelOption {
  id: string;
  name: string;
}

function parseAmount(raw: string): number {
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Dialog para ajustar el saldo de una cuenta (caja, banco, wallet, etc.).
 *
 * Inserta una transaction de ajuste por la diferencia entre el saldo
 * calculado del sistema y el saldo real ingresado por el usuario.
 * Editable: re-correr borra la transaction anterior y recrea.
 */
export function AccountOpeningBalanceDialog({
  accountId,
  accountName,
  currency,
  channels,
}: {
  accountId: string;
  accountName: string;
  currency: string;
  channels: ChannelOption[];
}) {
  const [open, setOpen] = useState(false);
  const { data: existing } = useAccountOpeningBalance(accountId, open);
  const setMut = useSetAccountOpeningBalance();
  const clearMut = useClearAccountOpeningBalance();

  const [adjustmentDate, setAdjustmentDate] = useState(todayIso());
  const [targetRaw, setTargetRaw] = useState("");
  const [channelId, setChannelId] = useState<string>(channels[0]?.id ?? "");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setAdjustmentDate(existing.adjustment_date);
      setTargetRaw(String(existing.target_balance));
      setNotes(existing.notes ?? "");
    } else {
      setAdjustmentDate(todayIso());
      setTargetRaw("");
      setNotes("");
      setChannelId(channels[0]?.id ?? "");
    }
  }, [open, existing, channels]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const target = parseAmount(targetRaw);
    if (!Number.isFinite(target)) {
      toast.error("Ingresá un saldo válido.");
      return;
    }
    if (!adjustmentDate) {
      toast.error("Ingresá la fecha de ajuste.");
      return;
    }
    if (!channelId) {
      toast.error("Elegí un canal para imputar el ajuste.");
      return;
    }
    setMut.mutate(
      {
        account_id: accountId,
        adjustment_date: adjustmentDate,
        target_balance: target,
        channel_id: channelId,
        notes: notes.trim().length > 0 ? notes.trim() : null,
      },
      {
        onSuccess: () => {
          toast.success(
            existing ? "Saldo actualizado." : "Saldo registrado.",
          );
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function onClear() {
    if (!existing) return;
    if (!confirm("¿Borrar el saldo de apertura? Se elimina la transaction de ajuste.")) return;
    clearMut.mutate(accountId, {
      onSuccess: () => {
        toast.success("Saldo de apertura eliminado.");
        setOpen(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  const TriggerIcon = existing ? Pencil : Wallet;
  const triggerLabel = existing ? "Editar saldo" : "Ajustar saldo";

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
          <DialogTitle>Ajustar saldo · {accountName}</DialogTitle>
          <DialogDescription>
            Fijá el saldo real de la cuenta al corte. El sistema inserta
            una transacción de ajuste por la diferencia con el saldo
            calculado. Se imputa al canal elegido.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Fecha de ajuste</Label>
              <DatePicker
                value={adjustmentDate}
                onChange={setAdjustmentDate}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Saldo real al corte ({currency})
              </Label>
              <Input
                inputMode="decimal"
                placeholder="0,00"
                value={targetRaw}
                onChange={(e) => setTargetRaw(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Canal de imputación</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger>
                <SelectValue placeholder="Elegí canal" />
              </SelectTrigger>
              <SelectContent position="popper">
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notas (opcional)</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. saldo según extracto bancario al 30/04."
            />
          </div>

          {existing && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <p className="font-medium">Ajuste registrado actualmente</p>
              <p className="font-mono">
                Corte: {existing.adjustment_date} · Saldo:{" "}
                ${existing.target_balance.toFixed(2)}
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
