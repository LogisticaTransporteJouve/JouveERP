"use client";

import { useState } from "react";
import { toast } from "sonner";

import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { amountToInput, formatMoney, parseArAmount } from "@/lib/format";

import { usePayLoanFromLine } from "../hooks/use-reconciliation";
import { suggestLoanSplit } from "../lib/bank-codes";
import type { StatementLine, StatementLoanInstallment } from "../schema";

const PARTS = [
  ["capital", "Capital"],
  ["interest", "Intereses"],
  ["late_interest", "Intereses exceso (punitorios)"],
  ["iva", "IVA"],
  ["taxes", "Impuestos (percepciones)"],
] as const;

type Part = (typeof PARTS)[number][0];

/** Pays a loan cuota with a debit that is not the plan's amount: the bank
 *  charged the interest by days, punitorios or taxes. The user splits the
 *  debit as the bank's detail of the cuota says; it must add up. */
export function PayLoanFromLineDialog({
  line,
  installment,
  open,
  onOpenChange,
}: {
  line: StatementLine;
  installment: StatementLoanInstallment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const debit = -line.amount;
  const pay = usePayLoanFromLine();
  const [values, setValues] = useState<Record<Part, string>>(() => {
    const s = suggestLoanSplit(debit, installment);
    return {
      capital: amountToInput(s.capital),
      interest: amountToInput(s.interest),
      late_interest: amountToInput(s.late_interest),
      iva: amountToInput(s.iva),
      taxes: amountToInput(s.taxes),
    };
  });
  const read = (k: Part) => parseArAmount(values[k]) ?? 0;
  const amounts: Record<Part, number> = {
    capital: read("capital"),
    interest: read("interest"),
    late_interest: read("late_interest"),
    iva: read("iva"),
    taxes: read("taxes"),
  };
  const total =
    Math.round(PARTS.reduce((s, [k]) => s + amounts[k], 0) * 100) / 100;
  const diff = Math.round((debit - total) * 100) / 100;

  function submit() {
    pay.mutate(
      {
        line_id: line.id,
        installment_id: installment.id,
        split: amounts,
      },
      {
        onSuccess: () => {
          toast.success(`Cuota ${installment.number} pagada y conciliada.`);
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Pagar cuota {installment.number} · {installment.loan_description}
          </DialogTitle>
          <DialogDescription>
            El banco debitó {formatMoney(debit)} y el plan dice{" "}
            {formatMoney(installment.amount)}. Separá el débito como lo muestra
            el detalle de la cuota en el home banking: el capital viene del
            plan; lo demás suele ser interés por días, punitorios e impuestos.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3">
          {PARTS.map(([key, label]) => (
            <div
              key={key}
              className="grid grid-cols-[1fr_10rem] items-center gap-3"
            >
              <Label htmlFor={`split-${key}`}>{label}</Label>
              <MoneyInput
                id={`split-${key}`}
                value={values[key]}
                onChange={(v) => setValues({ ...values, [key]: v })}
              />
            </div>
          ))}
          <p className="text-sm">
            Suma {formatMoney(total)}
            {diff === 0
              ? " · coincide con el débito."
              : ` · faltan ${formatMoney(diff)} para el débito.`}
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={pay.isPending || diff !== 0}
            onClick={submit}
          >
            Pagar y conciliar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
