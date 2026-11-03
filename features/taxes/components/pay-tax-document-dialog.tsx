"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPeriod, todayInAR } from "@/lib/format";

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
      setAmount(doc.amount === null ? "" : String(doc.amount));
    }
  }, [open, doc]);

  const missingAccount = doc !== null && doc.account_id === null;

  function onSubmit() {
    if (!doc) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
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
                <Input
                  id="tax-pay-date"
                  type="date"
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tax-pay-amount">Importe</Label>
                <Input
                  id="tax-pay-amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
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
          <Button
            type="button"
            onClick={onSubmit}
            disabled={payMut.isPending || !accountId || missingAccount}
          >
            Pagar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
