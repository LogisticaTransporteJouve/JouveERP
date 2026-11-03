"use client";

import { Tags } from "lucide-react";
import { useState } from "react";
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
import { Label } from "@/components/ui/label";

import { useRecategorizeExpense } from "../hooks/use-recategorize";
import type { ExpenseSource, RecategorizeExpenseInput } from "../schema";

import { CostTagSelect } from "./cost-tag-select";

/** The expense to recategorize, as the list that opens the dialog has it. */
export type RecategorizableExpense = {
  source: ExpenseSource;
  id: string;
  /** What the expense is, for the dialog's subtitle. */
  label: string;
  expense_account_id: string | null;
  cost_center_id: string | null;
};

const DEFAULT_ACCOUNT_LABEL: Record<ExpenseSource, string> = {
  transactions: "Sin cuenta (Gastos)",
  purchase_invoices: "Sin cuenta (Compras)",
};

/** The keys that changed, null for a cleared one ("" in the pickers). */
function changes(
  expense: RecategorizableExpense,
  account: string,
  costCenter: string,
): RecategorizeExpenseInput | null {
  const nextAccount = account || null;
  const nextCenter = costCenter || null;
  const input: RecategorizeExpenseInput = {
    source: expense.source,
    id: expense.id,
    ...(nextAccount !== expense.expense_account_id && {
      expense_account_id: nextAccount,
    }),
    ...(nextCenter !== expense.cost_center_id && {
      cost_center_id: nextCenter,
    }),
  };
  return input.expense_account_id !== undefined ||
    input.cost_center_id !== undefined
    ? input
    : null;
}

/**
 * Changes only the expense account and the cost center of an expense (a
 * manual one or a purchase); the entry is re-posted. Works on a reconciled
 * movement too: reconciliation locks the amount and dates, not these. The
 * database refuses a closed period or a movement a document owns, and that
 * message is shown as is.
 */
export function RecategorizeExpenseDialog({
  expense,
  onOpenChange,
}: {
  expense: RecategorizableExpense | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={expense !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {expense && (
          // Keyed so the pickers start from this expense's values.
          <RecategorizeForm
            key={`${expense.source}:${expense.id}`}
            expense={expense}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecategorizeForm({
  expense,
  onDone,
}: {
  expense: RecategorizableExpense;
  onDone: () => void;
}) {
  const mutation = useRecategorizeExpense();
  const [account, setAccount] = useState(expense.expense_account_id ?? "");
  const [costCenter, setCostCenter] = useState(expense.cost_center_id ?? "");
  const input = changes(expense, account, costCenter);

  function onSubmit() {
    if (!input) return;
    mutation.mutate(input, {
      onSuccess: () => {
        toast.success("Gasto recategorizado.");
        onDone();
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Recategorizar gasto</DialogTitle>
        <DialogDescription className="break-words">
          {expense.label}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs">Cuenta de gasto</Label>
          <CostTagSelect
            kind="expenseAccount"
            value={account}
            onChange={setAccount}
            noneLabel={DEFAULT_ACCOUNT_LABEL[expense.source]}
            disabled={mutation.isPending}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Centro de costo</Label>
          <CostTagSelect
            kind="costCenter"
            value={costCenter}
            onChange={setCostCenter}
            disabled={mutation.isPending}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          Solo cambia la imputación: el monto, la fecha y la conciliación quedan
          como están, y el asiento se rehace.
        </p>
      </div>
      <DialogFooter className="gap-2 sm:gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onDone}
          disabled={mutation.isPending}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={mutation.isPending || !input}
        >
          {mutation.isPending ? "Guardando…" : "Recategorizar"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** An icon button that opens the dialog, for rows that carry inline
 *  actions (the purchases list). */
export function RecategorizeExpenseButton({
  expense,
}: {
  expense: RecategorizableExpense;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Recategorizar"
        title="Recategorizar"
        onClick={() => setOpen(true)}
      >
        <Tags className="size-4" />
      </Button>
      <RecategorizeExpenseDialog
        expense={open ? expense : null}
        onOpenChange={setOpen}
      />
    </>
  );
}
