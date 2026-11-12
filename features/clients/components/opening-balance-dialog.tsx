"use client";

import { Pencil, Wallet } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { MoneyInput } from "@/components/money-input";
import { useConfirm } from "@/components/providers/confirm-provider";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  useClearClientOpeningBalance,
  useClientOpeningBalance,
  useSetClientOpeningBalance,
} from "../hooks/use-clients";
import { todayIsoLocal as todayIso } from "@/lib/date-range";
import {
  formatArgentineDate,
  formatNumber2,
  parseArAmount,
  signedAmountToInput,
} from "@/lib/format";

/**
 * Dialog to set/edit/delete the client's opening balance.
 *
 * Use case: after migrating historical invoices that all end up
 * outstanding, the user sets the real balance at the cutoff. The system
 * applies FIFO from the oldest invoice to the newest one dated ≤ cutoff
 * until the remainder matches `target_balance`.
 */
export function OpeningBalanceDialog({
  clientId,
  prefill = false,
  trigger,
}: {
  clientId: string;
  /** If true, opening prefills with the values of the existing
   *  adjustment ("edit the amount" mode). Default = false (new
   *  adjustment, empty form). */
  prefill?: boolean;
  /** Replaces the default trigger (the "Ajustar saldo" button). */
  trigger?: React.ReactNode;
}) {
  const { data: existing } = useClientOpeningBalance(clientId);
  const [open, setOpen] = useState(false);
  const setMut = useSetClientOpeningBalance();
  const clearMut = useClearClientOpeningBalance();
  const confirm = useConfirm();

  const [openingDate, setOpeningDate] = useState(todayIso());
  const [targetRaw, setTargetRaw] = useState("");
  const targetId = useId();
  const [targetUsdRaw, setTargetUsdRaw] = useState("");
  const targetUsdId = useId();
  const [notes, setNotes] = useState("");

  // When opening the dialog: if prefill=true and an adjustment exists, we
  // prefill with its values (edit-amount mode). Otherwise it starts empty
  // — each opening is a new reconciliation, not an edit of the prior value.
  useEffect(() => {
    if (!open) return;
    if (prefill && existing) {
      setOpeningDate(existing.opening_date);
      setTargetRaw(signedAmountToInput(existing.target_balance));
      setTargetUsdRaw(
        existing.target_balance_usd == null
          ? ""
          : signedAmountToInput(existing.target_balance_usd),
      );
      setNotes(existing.notes ?? "");
    } else {
      setOpeningDate(todayIso());
      setTargetRaw("");
      setTargetUsdRaw("");
      setNotes("");
    }
  }, [open, prefill, existing]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const target = parseArAmount(targetRaw);
    if (target == null || target < 0) {
      toast.error("Ingresá un saldo válido (no negativo).");
      return;
    }
    let targetUsd: number | null = null;
    if (targetUsdRaw.trim() !== "") {
      targetUsd = parseArAmount(targetUsdRaw);
      if (targetUsd == null || targetUsd < 0) {
        toast.error("Ingresá un saldo en dólares válido (no negativo).");
        return;
      }
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
        target_balance_usd: targetUsd,
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

  async function onClear() {
    if (!existing) return;
    const ok = await confirm({
      title: "Borrar el ajuste de saldo",
      description:
        "Las imputaciones del ajuste se revierten. Esta acción no se puede deshacer.",
      confirmLabel: "Borrar",
      tone: "destructive",
    });
    if (!ok) return;
    clearMut.mutate(clientId, {
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
            Fijá la deuda real del cliente a una fecha. El sistema reconcilia el
            saldo al valor ingresado e imputa FIFO contra las facturas
            anteriores. Editable: re-correr sobrescribe.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Fecha de corte</Label>
              <DatePicker value={openingDate} onChange={setOpeningDate} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={targetId} className="text-xs">
                Saldo real al corte ($)
              </Label>
              <MoneyInput
                id={targetId}
                placeholder="0,00"
                value={targetRaw}
                onChange={setTargetRaw}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor={targetUsdId} className="text-xs">
              Saldo en dólares al corte (US$, opcional)
            </Label>
            <MoneyInput
              id={targetUsdId}
              placeholder="Sin ajustar"
              value={targetUsdRaw}
              onChange={setTargetUsdRaw}
            />
            <p className="text-xs text-muted-foreground">
              Imputa FIFO contra las facturas en dólares anteriores. Vacío: se
              vuelve a aplicar el saldo en dólares ya fijado; si no hay, los
              dólares no se tocan.
            </p>
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
                Corte: {formatArgentineDate(existing.opening_date)} · Saldo: $
                {formatNumber2(existing.target_balance)} · Imputado a facturas:
                ${formatNumber2(existing.total_settled)}
              </p>
              {existing.target_balance_usd != null && (
                <p className="font-mono">
                  Saldo: US${formatNumber2(existing.target_balance_usd)} ·
                  Imputado a facturas: US$
                  {formatNumber2(existing.total_settled_usd ?? 0)}
                </p>
              )}
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
