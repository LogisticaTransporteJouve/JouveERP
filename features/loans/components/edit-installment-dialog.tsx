"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { MoneyInput } from "@/components/money-input";
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
import { amountToInput, formatMoney, parseArAmount } from "@/lib/format";

import { useUpdateInstallment } from "../hooks/use-loans";
import {
  INSTALLMENT_SPLIT_KEYS,
  INSTALLMENT_SPLIT_LABEL,
  INSTALLMENT_ZERO_ERROR,
  splitTotal,
  type InstallmentSplit,
  type LoanInstallment,
} from "../schema";

type SplitDraft = Record<keyof InstallmentSplit, string>;

// A blank amount seeds a blank capital, not "0,00": blank is no amount.
function draftOf(
  split: InstallmentSplit | null,
  amount: number | null,
): SplitDraft {
  const capital = split?.capital ?? amount;
  return {
    capital: capital === null ? "" : amountToInput(capital),
    interest: amountToInput(split?.interest ?? 0),
    iva: amountToInput(split?.iva ?? 0),
    perception: amountToInput(split?.perception ?? 0),
    other: amountToInput(split?.other ?? 0),
  };
}

function parseDraft(draft: SplitDraft): InstallmentSplit {
  return {
    capital: parseArAmount(draft.capital) ?? 0,
    interest: parseArAmount(draft.interest) ?? 0,
    iva: parseArAmount(draft.iva) ?? 0,
    perception: parseArAmount(draft.perception) ?? 0,
    other: parseArAmount(draft.other) ?? 0,
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
      setAmount(amountToInput(installment.amount));
      setDueDate(installment.due_date);
      setSplitOn(installment.split !== null);
      setSplit(draftOf(installment.split, installment.amount));
    }
  }, [open, installment]);

  const splitSum = splitTotal(parseDraft(split));

  function onSubmit() {
    if (!installment) return;
    const parsedAmount = parseArAmount(amount);
    // A blank amount is no amount: saving it as 0 dropped the cuota from the
    // schedule. With the split on, blank parts are optional but the cuota
    // still needs a total.
    const splitBlank = Object.values(split).every((v) => v.trim() === "");
    if (splitOn ? splitBlank : parsedAmount === null) {
      toast.error("Monto requerido.");
      return;
    }
    if (splitOn ? splitSum <= 0 : (parsedAmount ?? 0) <= 0) {
      toast.error(INSTALLMENT_ZERO_ERROR);
      return;
    }
    const input =
      splitOn || parsedAmount === null
        ? { id: installment.id, due_date: dueDate, split: parseDraft(split) }
        : {
            id: installment.id,
            amount: parsedAmount,
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
              <MoneyInput
                id="edit-amount"
                value={splitOn ? amountToInput(splitSum) : amount}
                disabled={splitOn}
                onChange={setAmount}
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
                    draftOf(installment?.split ?? null, parseArAmount(amount)),
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
                  <MoneyInput
                    id={`split-${k}`}
                    value={split[k]}
                    onChange={(v) => setSplit((prev) => ({ ...prev, [k]: v }))}
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
