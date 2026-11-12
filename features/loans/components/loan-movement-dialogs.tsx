"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DisabledHint } from "@/components/disabled-hint";
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
import { ExpenseTransactionPicker } from "@/features/transactions/components/expense-transaction-picker";
import { formatMoney, todayInAR } from "@/lib/format";

import {
  useAdoptInstallmentPayment,
  useRecordLoanDisbursement,
} from "../hooks/use-loans";
import type { LoanDetail, LoanInstallment } from "../schema";

/** Uses a manual expense already loaded in Caja as the payment of a cuota:
 *  no second movement; the expense becomes the cuota's. */
export function AdoptInstallmentPaymentDialog({
  loan,
  installment,
  onClose,
}: {
  loan: Pick<LoanDetail, "channel_id" | "currency">;
  installment: LoanInstallment | null;
  onClose: () => void;
}) {
  const adoptMut = useAdoptInstallmentPayment();
  const open = installment !== null;
  const [transactionId, setTransactionId] = useState<string | null>(null);

  useEffect(() => {
    if (open) setTransactionId(null);
  }, [open]);

  function onSubmit() {
    if (!installment || !transactionId) return;
    adoptMut.mutate(
      { id: installment.id, transaction_id: transactionId },
      {
        onSuccess: () => {
          toast.success("Cuota pagada con el egreso elegido.");
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Usar un egreso ya cargado</DialogTitle>
          <DialogDescription>
            Si el débito de la cuota {installment?.number} ya está en Caja como
            egreso manual, elegilo: la cuota queda pagada con su fecha e importe
            y no se duplica el movimiento.
            {installment?.split
              ? ` La cuota tiene desglose: el egreso tiene que ser de ${formatMoney(installment.amount)}.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Egreso</Label>
          <ExpenseTransactionPicker
            value={transactionId}
            onChange={setTransactionId}
            aroundDate={installment?.due_date ?? ""}
            channelId={loan.channel_id}
            // A USD cuota can be paid by a peso expense (at its rate).
            currency={loan.currency === "USD" ? undefined : loan.currency}
            manualOnly
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <DisabledHint reason={!transactionId ? "Elegí el egreso." : null}>
            <Button
              type="button"
              onClick={onSubmit}
              disabled={adoptMut.isPending || !transactionId}
            >
              Vincular
            </Button>
          </DisabledHint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Records the disbursement: a new income in the bank, or a manual income
 *  already loaded. Either way its entry credits the loan liability. */
export function RecordDisbursementDialog({
  loan,
  accountOptions,
  open,
  onClose,
}: {
  loan: Pick<
    LoanDetail,
    "id" | "channel_id" | "currency" | "principal" | "first_due_date"
  >;
  accountOptions: { id: string; name: string }[];
  open: boolean;
  onClose: () => void;
}) {
  const recordMut = useRecordLoanDisbursement();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayInAR());
  const [transactionId, setTransactionId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode("new");
      setAccountId("");
      setDate(todayInAR());
      setTransactionId(null);
    }
  }, [open]);

  const ready = mode === "new" ? !!accountId && !!date : !!transactionId;

  function onSubmit() {
    recordMut.mutate(
      mode === "new"
        ? { loan_id: loan.id, account_id: accountId, date }
        : { loan_id: loan.id, transaction_id: transactionId },
      {
        onSuccess: () => {
          toast.success("Desembolso registrado.");
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar desembolso</DialogTitle>
          <DialogDescription>
            El ingreso de {formatMoney(loan.principal, loan.currency)} al banco
            se asienta contra la deuda del préstamo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Select
            value={mode}
            onValueChange={(v) =>
              setMode(v === "existing" ? "existing" : "new")
            }
          >
            <SelectTrigger aria-label="Cómo registrarlo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">Registrar el ingreso ahora</SelectItem>
              <SelectItem value="existing">
                Usar un ingreso ya cargado en Caja
              </SelectItem>
            </SelectContent>
          </Select>
          {mode === "new" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="disb-date">Fecha</Label>
                <DatePicker id="disb-date" value={date} onChange={setDate} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="disb-account">Cuenta</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger id="disb-account">
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
          ) : (
            <div className="space-y-1">
              <Label>Ingreso</Label>
              <ExpenseTransactionPicker
                kind="income"
                value={transactionId}
                onChange={setTransactionId}
                aroundDate={date}
                channelId={loan.channel_id}
                currency={loan.currency}
                manualOnly
              />
              <p className="text-xs text-muted-foreground">
                Tiene que ser del mismo canal, moneda e importe que el capital.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <DisabledHint
            reason={
              ready
                ? null
                : mode === "new"
                  ? !accountId
                    ? "Elegí la cuenta."
                    : "Completá la fecha."
                  : "Elegí el ingreso."
            }
          >
            <Button
              type="button"
              onClick={onSubmit}
              disabled={recordMut.isPending || !ready}
            >
              Registrar
            </Button>
          </DisabledHint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
