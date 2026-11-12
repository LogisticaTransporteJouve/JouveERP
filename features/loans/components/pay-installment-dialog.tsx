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
import { amountToInput, parseArAmount, todayInAR } from "@/lib/format";

import { usePayInstallment } from "../hooks/use-loans";
import type { LoanInstallment } from "../schema";

import { FxPaymentFields, useFxPayment } from "./fx-payment-fields";

export function PayInstallmentDialog({
  installment,
  loanCurrency,
  accountOptions,
  onClose,
}: {
  installment: LoanInstallment | null;
  loanCurrency: string;
  /** Accounts in the loan's currency, and peso accounts for a USD loan. */
  accountOptions: { id: string; name: string; currency: string }[];
  onClose: () => void;
}) {
  const payMut = usePayInstallment();
  const open = installment !== null;
  const [paidDate, setPaidDate] = useState(todayInAR());
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const account = accountOptions.find((a) => a.id === accountId);
  // A USD cuota from a peso account: paid whole, at a rate.
  const inPesos = account !== undefined && account.currency !== loanCurrency;
  const fx = useFxPayment({
    active: inPesos,
    date: paidDate,
    usdAmount: installment?.amount ?? 0,
  });
  const { reset: resetFx } = fx;

  useEffect(() => {
    if (open && installment) {
      setPaidDate(todayInAR());
      setAccountId("");
      setAmount(amountToInput(installment.amount));
      resetFx();
    }
  }, [open, installment, resetFx]);

  const blocked = !accountId
    ? "Elegí la cuenta de pago."
    : inPesos && fx.pesos === null
      ? "Ingresá la cotización o el monto en pesos."
      : null;

  function onSubmit() {
    if (!installment) return;
    if (blocked) {
      toast.error(blocked);
      return;
    }
    payMut.mutate(
      {
        id: installment.id,
        paid_date: paidDate,
        account_id: accountId,
        amount: inPesos ? installment.amount : (parseArAmount(amount) ?? 0),
        account_amount: inPesos ? fx.pesos : null,
      },
      {
        onSuccess: () => {
          toast.success("Cuota pagada y egreso registrado en caja.");
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
          <DialogTitle>Pagar cuota {installment?.number}</DialogTitle>
          <DialogDescription>
            Marca la cuota como pagada y registra el egreso en la cuenta
            elegida.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pay-date">Fecha de pago</Label>
              <DatePicker
                id="pay-date"
                value={paidDate}
                onChange={setPaidDate}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pay-amount">Monto</Label>
              <MoneyInput
                id="pay-amount"
                value={amount}
                // A split cuota, or a USD one paid in pesos, is paid whole.
                disabled={installment?.split != null || inPesos}
                onChange={setAmount}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-account">Cuenta</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="pay-account">
                <SelectValue placeholder="Elegí la cuenta" />
              </SelectTrigger>
              <SelectContent>
                {accountOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                    {a.currency !== loanCurrency ? ` (${a.currency})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {inPesos && <FxPaymentFields idPrefix="pay" fx={fx} />}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <DisabledHint reason={blocked}>
            <Button
              type="button"
              onClick={onSubmit}
              disabled={payMut.isPending || blocked !== null}
            >
              Pagar
            </Button>
          </DisabledHint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
