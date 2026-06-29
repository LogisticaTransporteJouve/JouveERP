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

import { usePayInstallment } from "../hooks/use-loans";
import type { LoanInstallment } from "../schema";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PayInstallmentDialog({
  installment,
  accountOptions,
  onClose,
}: {
  installment: LoanInstallment | null;
  accountOptions: { id: string; name: string }[];
  onClose: () => void;
}) {
  const payMut = usePayInstallment();
  const open = installment !== null;
  const [paidDate, setPaidDate] = useState(today());
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (open && installment) {
      setPaidDate(today());
      setAccountId("");
      setAmount(String(installment.amount));
    }
  }, [open, installment]);

  function onSubmit() {
    if (!installment) return;
    if (!accountId) {
      toast.error("Elegí la cuenta de pago.");
      return;
    }
    payMut.mutate(
      {
        id: installment.id,
        paid_date: paidDate,
        account_id: accountId,
        amount: Number(amount),
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
              <Input
                id="pay-date"
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pay-amount">Monto</Label>
              <Input
                id="pay-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
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
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={payMut.isPending || !accountId}
          >
            Pagar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
