"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DisabledHint, firstReason } from "@/components/disabled-hint";
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
import {
  amountToInput,
  formatPeriod,
  parseArAmount,
  todayInAR,
} from "@/lib/format";

import { usePayTaxDocument } from "../hooks/use-tax-documents";
import { taxDocumentLabel, type TaxDocument } from "../schema";

export function PayTaxDocumentDialog({
  doc,
  accountOptions,
  onClose,
}: {
  doc: TaxDocument | null;
  /** Active cash and bank accounts in pesos. */
  accountOptions: { id: string; name: string }[];
  onClose: () => void;
}) {
  const payMut = usePayTaxDocument();
  const open = doc !== null;
  const [paidDate, setPaidDate] = useState(todayInAR());
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (open && doc) {
      setPaidDate(todayInAR());
      setAccountId("");
      setAmount(doc.amount === null ? "" : amountToInput(doc.amount));
    }
  }, [open, doc]);

  const missingAccount = doc !== null && doc.account_id === null;

  function onSubmit() {
    if (!doc) return;
    const value = parseArAmount(amount) ?? 0;
    if (value <= 0) {
      toast.error("Indicá el importe pagado.");
      return;
    }
    payMut.mutate(
      { id: doc.id, paid_date: paidDate, account_id: accountId, amount: value },
      {
        onSuccess: () => {
          toast.success("Impuesto pagado: egreso y asiento registrados.");
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
          <DialogTitle>
            Pagar {doc ? taxDocumentLabel(doc) : "impuesto"}
          </DialogTitle>
          <DialogDescription>
            {doc ? `Período ${formatPeriod(doc.period)}. ` : ""}
            Registra el egreso en la cuenta elegida y su asiento contra{" "}
            {doc?.account_name ?? "la cuenta contable del impuesto"}.
          </DialogDescription>
        </DialogHeader>
        {missingAccount ? (
          <p className="text-sm">
            Antes de pagar, editá el impuesto y elegí su cuenta contable (la
            deuda fiscal o el gasto que cancela el pago).
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="tax-pay-date">Fecha de pago</Label>
                <DatePicker
                  id="tax-pay-date"
                  value={paidDate}
                  onChange={setPaidDate}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tax-pay-amount">Importe</Label>
                <MoneyInput
                  id="tax-pay-amount"
                  value={amount}
                  onChange={setAmount}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tax-pay-account">Pagado desde</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="tax-pay-account">
                  <SelectValue placeholder="Elegí la cuenta" />
                </SelectTrigger>
                <SelectContent>
                  {accountOptions.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {accountOptions.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  No hay cuentas en pesos activas (o no tenés acceso a Cuentas).
                </p>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <DisabledHint
            reason={firstReason(
              [
                missingAccount,
                "Antes, editá el impuesto y elegí su cuenta contable.",
              ],
              [!accountId, "Elegí la cuenta."],
            )}
          >
            <Button
              type="button"
              onClick={onSubmit}
              disabled={payMut.isPending || !accountId || missingAccount}
            >
              Pagar
            </Button>
          </DisabledHint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
