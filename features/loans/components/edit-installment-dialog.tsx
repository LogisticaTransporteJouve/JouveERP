"use client";

import { useEffect, useState } from "react";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/format";

import { useUpdateInstallment } from "../hooks/use-loans";
import {
  INSTALLMENT_SPLIT_KEYS,
  INSTALLMENT_SPLIT_LABEL,
  splitTotal,
  type InstallmentSplit,
  type LoanInstallment,
} from "../schema";

type SplitDraft = Record<keyof InstallmentSplit, string>;

function draftOf(split: InstallmentSplit | null, amount: number): SplitDraft {
  return {
    capital: String(split?.capital ?? amount),
    interest: String(split?.interest ?? 0),
    iva: String(split?.iva ?? 0),
    perception: String(split?.perception ?? 0),
    other: String(split?.other ?? 0),
  };
}

function parseDraft(draft: SplitDraft): InstallmentSplit {
  return {
    capital: Number(draft.capital) || 0,
    interest: Number(draft.interest) || 0,
    iva: Number(draft.iva) || 0,
    perception: Number(draft.perception) || 0,
    other: Number(draft.other) || 0,
  };
}

export function EditInstallmentDialog({
  installment,
  onClose,
}: {
  installment: LoanInstallment | null;
  onClose: () => void;
}) {
  const updateMut = useUpdateInstallment();
  const open = installment !== null;
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [splitOn, setSplitOn] = useState(false);
  const [split, setSplit] = useState<SplitDraft>(draftOf(null, 0));

  useEffect(() => {
    if (open && installment) {
      setAmount(String(installment.amount));
      setDueDate(installment.due_date);
      setSplitOn(installment.split !== null);
      setSplit(draftOf(installment.split, installment.amount));
    }
  }, [open, installment]);

  const splitSum = splitTotal(parseDraft(split));

  function onSubmit() {
    if (!installment) return;
    const input = splitOn
      ? { id: installment.id, due_date: dueDate, split: parseDraft(split) }
      : {
          id: installment.id,
          amount: Number(amount),
          due_date: dueDate,
          ...(installment.split !== null && { split: null }),
        };
    updateMut.mutate(input, {
      onSuccess: () => {
        toast.success("Cuota actualizada.");
        onClose();
      },
      onError: (err) => toast.error(err.message),
    });
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
          <DialogTitle>Editar cuota {installment?.number}</DialogTitle>
          <DialogDescription>
            Ajustá el monto o el vencimiento (por ej. UVA, tasa variable). Con
            el desglose, el pago asienta el capital contra el préstamo y el
            resto como intereses, IVA y percepción.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-amount">Monto</Label>
              <Input
                id="edit-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={splitOn ? String(splitSum) : amount}
                disabled={splitOn}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-due">Vencimiento</Label>
              <Input
                id="edit-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="edit-split"
              checked={splitOn}
              onCheckedChange={(v) => {
                const on = v === true;
                setSplitOn(on);
                if (on)
                  setSplit(
                    draftOf(installment?.split ?? null, Number(amount) || 0),
                  );
              }}
            />
            <Label htmlFor="edit-split" className="font-normal">
              Desglosar capital, interés, IVA y cargos
            </Label>
          </div>
          {splitOn && (
            <div className="grid grid-cols-2 gap-3">
              {INSTALLMENT_SPLIT_KEYS.map((k) => (
                <div
                  key={k}
                  className={
                    k === "other" ? "col-span-2 space-y-1" : "space-y-1"
                  }
                >
                  <Label htmlFor={`split-${k}`}>
                    {INSTALLMENT_SPLIT_LABEL[k]}
                  </Label>
                  <Input
                    id={`split-${k}`}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min={0}
                    value={split[k]}
                    onChange={(e) =>
                      setSplit((prev) => ({ ...prev, [k]: e.target.value }))
                    }
                  />
                </div>
              ))}
              <p className="col-span-2 text-xs text-muted-foreground">
                Total de la cuota: {formatMoney(splitSum)}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={updateMut.isPending}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
