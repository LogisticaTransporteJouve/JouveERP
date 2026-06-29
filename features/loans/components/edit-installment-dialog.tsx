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

import { useUpdateInstallment } from "../hooks/use-loans";
import type { LoanInstallment } from "../schema";

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

  useEffect(() => {
    if (open && installment) {
      setAmount(String(installment.amount));
      setDueDate(installment.due_date);
    }
  }, [open, installment]);

  function onSubmit() {
    if (!installment) return;
    updateMut.mutate(
      { id: installment.id, amount: Number(amount), due_date: dueDate },
      {
        onSuccess: () => {
          toast.success("Cuota actualizada.");
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
          <DialogTitle>Editar cuota {installment?.number}</DialogTitle>
          <DialogDescription>
            Ajustá el monto o el vencimiento (por ej. UVA, tasa variable).
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="edit-amount">Monto</Label>
            <Input
              id="edit-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={amount}
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
