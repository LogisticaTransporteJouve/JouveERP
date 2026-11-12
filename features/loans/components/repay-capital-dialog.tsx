"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DisabledHint } from "@/components/disabled-hint";
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
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney, parseArAmount, todayInAR } from "@/lib/format";

import { useRepayLoanCapital } from "../hooks/use-loans";
import type { LoanDetail } from "../schema";

import { FxPaymentFields, useFxPayment } from "./fx-payment-fields";

/** «Devolución de capital» of an open-ended loan: part or all of the capital
 *  from an account (a USD loan also from a peso account, at a rate). The
 *  later interest cuotas follow the capital still owed. */
export function RepayCapitalDialog({
  loan,
  accountOptions,
  open,
  onClose,
}: {
  loan: Pick<LoanDetail, "id" | "currency" | "capital_outstanding">;
  accountOptions: { id: string; name: string; currency: string }[];
  open: boolean;
  onClose: () => void;
}) {
  const repay = useRepayLoanCapital();
  const [date, setDate] = useState(todayInAR());
  const [accountId, setAccountId] = useState("");
  const [amountText, setAmountText] = useState("");
  const amount = parseArAmount(amountText) ?? 0;
  const account = accountOptions.find((a) => a.id === accountId);
  const inPesos = account !== undefined && account.currency !== loan.currency;
  const fx = useFxPayment({ active: inPesos, date, usdAmount: amount });
  const { reset: resetFx } = fx;

  useEffect(() => {
    if (open) {
      setDate(todayInAR());
      setAccountId("");
      setAmountText("");
      resetFx();
    }
  }, [open, resetFx]);

  const blocked = !accountId
    ? "Elegí la cuenta."
    : amount <= 0
      ? "Ingresá el capital que se devuelve."
      : amount > loan.capital_outstanding
        ? `No puede superar el capital adeudado (${formatMoney(loan.capital_outstanding, loan.currency)}).`
        : inPesos && fx.pesos === null
          ? "Ingresá la cotización o el monto en pesos."
          : null;

  function onSubmit() {
    if (blocked) {
      toast.error(blocked);
      return;
    }
    repay.mutate(
      {
        loan_id: loan.id,
        date,
        account_id: accountId,
        amount,
        account_amount: inPesos ? fx.pesos : null,
      },
      {
        onSuccess: () => {
          toast.success("Devolución de capital registrada en caja.");
          onClose();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Devolución de capital</DialogTitle>
          <DialogDescription>
            Registra el egreso del capital devuelto. Las cuotas de interés
            siguientes se recalculan sobre lo que se sigue debiendo (
            {formatMoney(loan.capital_outstanding, loan.currency)} hoy).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="repay-date">Fecha</Label>
              <DatePicker id="repay-date" value={date} onChange={setDate} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="repay-amount">Capital ({loan.currency})</Label>
              <MoneyInput
                id="repay-amount"
                value={amountText}
                onChange={setAmountText}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="repay-account">Cuenta</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="repay-account">
                <SelectValue placeholder="Elegí la cuenta" />
              </SelectTrigger>
              <SelectContent>
                {accountOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                    {a.currency !== loan.currency ? ` (${a.currency})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {inPesos && <FxPaymentFields idPrefix="repay" fx={fx} />}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <DisabledHint reason={blocked}>
            <Button
              type="button"
              onClick={onSubmit}
              disabled={repay.isPending || blocked !== null}
            >
              Registrar
            </Button>
          </DisabledHint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
