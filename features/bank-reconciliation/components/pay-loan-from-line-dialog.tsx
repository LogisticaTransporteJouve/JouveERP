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
import {
  amountToInput,
  formatArgentineDate,
  formatMoney,
  parseArAmount,
} from "@/lib/format";

import {
  usePayableInstallments,
  usePayLoanFromLine,
} from "../hooks/use-reconciliation";
import { suggestLoanSplit } from "../lib/bank-codes";
import type {
  PayableLoanInstallment,
  StatementLine,
  StatementLoanInstallment,
} from "../schema";

const PARTS = [
  ["capital", "Capital"],
  ["interest", "Intereses"],
  ["late_interest", "Intereses exceso (punitorios)"],
  ["iva", "IVA"],
  ["iva_perception", "Percepción IVA"],
  ["taxes", "Percepción IIBB / impuestos"],
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
      iva_perception: amountToInput(s.iva_perception),
    };
  });
  // Interest is the rest of the debit until the user types it: the detail
  // of the cuota gives capital, taxes and the rest, and interest follows.
  const [interestTyped, setInterestTyped] = useState(false);
  const read = (k: Part) => parseArAmount(values[k]) ?? 0;
  function change(key: Part, v: string) {
    const next = { ...values, [key]: v };
    if (key === "interest") setInterestTyped(true);
    else if (!interestTyped) {
      const others = PARTS.filter(([k]) => k !== "interest").reduce(
        (sum, [k]) => sum + (parseArAmount(next[k]) ?? 0),
        0,
      );
      const rest = Math.round((debit - others) * 100) / 100;
      next.interest = amountToInput(Math.max(0, rest));
    }
    setValues(next);
  }
  const amounts: Record<Part, number> = {
    capital: read("capital"),
    interest: read("interest"),
    late_interest: read("late_interest"),
    iva: read("iva"),
    taxes: read("taxes"),
    iva_perception: read("iva_perception"),
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
            el detalle de la cuota en el home banking (capital, impuestos,
            intereses exceso): los intereses se completan con el resto.
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
                onChange={(v) => change(key, v)}
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

/** «Pagar cuota de préstamo…» on an open debit line: the pending cuotas of
 *  every active loan, the nearest due date first. A cuota in the line's
 *  currency for the debit is paid and matched at once, one for another amount
 *  is split first; a USD cuota from a peso line is paid whole at the rate the
 *  debit implies (shown next to the official one). */
export function PickLoanInstallmentDialog({
  line,
  currency,
  open,
  onOpenChange,
}: {
  line: StatementLine;
  /** The statement account's currency. */
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const debit = -line.amount;
  const list = usePayableInstallments(line.id, open);
  const pay = usePayLoanFromLine();
  const [splitTarget, setSplitTarget] =
    useState<StatementLoanInstallment | null>(null);
  const rate = (n: number) =>
    n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

  function choose(i: PayableLoanInstallment) {
    const sameCurrency = i.currency === currency;
    if (sameCurrency && Math.abs(i.amount - debit) > 0.005) {
      setSplitTarget(i);
      return;
    }
    pay.mutate(
      { line_id: line.id, installment_id: i.id },
      {
        onSuccess: () => {
          toast.success(`${installmentName(i)} pagada y conciliada.`);
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  const installments = (list.data?.installments ?? []).filter(
    (i) =>
      i.currency === currency || (i.currency === "USD" && currency === "ARS"),
  );
  const official = list.data?.usd_rate ?? null;

  return (
    <>
      <Dialog open={open && splitTarget === null} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Pagar cuota de préstamo</DialogTitle>
            <DialogDescription>
              Elegí la cuota que paga el débito de{" "}
              {formatMoney(debit, currency)} del{" "}
              {formatArgentineDate(line.line_date)}: queda pagada y la línea
              conciliada.
            </DialogDescription>
          </DialogHeader>
          {list.isPending ? (
            <p className="text-muted-foreground text-sm">Buscando cuotas…</p>
          ) : list.error ? (
            <p role="alert" className="text-sm">
              {list.error.message}
            </p>
          ) : installments.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No hay cuotas pendientes de préstamos activos.
            </p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
              {installments.map((i) => {
                const fx = i.currency !== currency;
                const implied = fx && i.amount > 0 ? debit / i.amount : null;
                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      disabled={pay.isPending}
                      onClick={() => choose(i)}
                      className="hover:bg-muted/50 focus-visible:ring-ring w-full px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                    >
                      <span className="font-medium">
                        {installmentName(i)} · {i.loan_description}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        Vence el {formatArgentineDate(i.due_date)} ·{" "}
                        {formatMoney(i.amount, i.currency)}
                        {implied !== null &&
                          ` · cotización implícita ${rate(implied)}${
                            official
                              ? ` (oficial ${rate(official.rate)} del ${formatArgentineDate(official.rate_date)})`
                              : " (sin cotización oficial cargada)"
                          }`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {splitTarget && (
        <PayLoanFromLineDialog
          line={line}
          installment={splitTarget}
          open
          onOpenChange={(next) => {
            if (!next) {
              setSplitTarget(null);
              onOpenChange(false);
            }
          }}
        />
      )}
    </>
  );
}

function installmentName(i: PayableLoanInstallment): string {
  if (i.kind === "devolucion_capital") return "Devolución de capital";
  return i.is_open_ended
    ? `Interés ${i.number}`
    : `Cuota ${i.number}/${i.count}`;
}
