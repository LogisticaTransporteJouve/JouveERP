"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import {
  useAddPayrollEntryExtra,
  usePayrollEntryExtras,
  useRemovePayrollEntryExtra,
} from "../hooks/use-payroll";

import { formatNumber2 } from "@/lib/format";
const ARS = { format: (n: number) => formatNumber2(n) };

type AddValues = { amount: string; description: string };

export function PayrollExtrasDialog({
  entryId,
  employeeName,
  total,
  year,
  month,
  disabled,
}: {
  entryId: string;
  employeeName: string;
  total: number;
  year: number;
  month: number;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 font-mono text-xs"
        >
          {total > 0 ? `$ ${ARS.format(total)}` : "—"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Extras — {employeeName}</DialogTitle>
          <DialogDescription>
            Cada línea suma al campo Extras del mes.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <ExtrasBody
            entryId={entryId}
            year={year}
            month={month}
            disabled={disabled}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ExtrasBody({
  entryId,
  year,
  month,
  disabled,
}: {
  entryId: string;
  year: number;
  month: number;
  disabled: boolean;
}) {
  const { data: extras = [], isLoading } = usePayrollEntryExtras(entryId);
  const addMut = useAddPayrollEntryExtra();
  const removeMut = useRemovePayrollEntryExtra();

  const form = useForm<AddValues>({
    defaultValues: { amount: "", description: "" },
  });

  function onAdd(values: AddValues) {
    const amount = Number(values.amount.replace(/,/g, "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Monto inválido.");
      return;
    }
    addMut.mutate(
      {
        entry_id: entryId,
        amount,
        description: values.description.trim(),
        period_year: year,
        period_month: month,
      },
      {
        onSuccess: () => {
          toast.success("Extra agregado.");
          form.reset({ amount: "", description: "" });
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function onRemove(id: string) {
    removeMut.mutate(
      { id, entry_id: entryId, period_year: year, period_month: month },
      {
        onSuccess: () => toast.success("Extra eliminado."),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  const totalLocal = (extras ?? []).reduce(
    (acc, x) => acc + Number(x.amount),
    0,
  );

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {isLoading ? (
          <li className="text-sm text-muted-foreground">Cargando…</li>
        ) : (extras ?? []).length === 0 ? (
          <li className="text-sm text-muted-foreground">Sin extras todavía.</li>
        ) : (
          (extras ?? []).map((extra) => (
            <li
              key={extra.id}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm"
            >
              <span className="flex-1 truncate">{extra.description}</span>
              <span className="font-mono">
                $ {ARS.format(Number(extra.amount))}
              </span>
              {!disabled && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => onRemove(extra.id)}
                  disabled={removeMut.isPending}
                  aria-label="Borrar"
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              )}
            </li>
          ))
        )}
      </ul>

      {(extras ?? []).length > 0 && (
        <div className="flex items-center justify-between border-t pt-2 text-sm font-medium">
          <span>Total</span>
          <span className="font-mono">$ {ARS.format(totalLocal)}</span>
        </div>
      )}

      {!disabled && (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onAdd)}
            className="flex items-end gap-2 border-t pt-3"
          >
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Descripción"
                      autoComplete="off"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem className="w-28">
                  <FormControl>
                    <Input
                      {...field}
                      inputMode="decimal"
                      placeholder="Monto"
                      autoComplete="off"
                      className="text-right font-mono"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              size="icon"
              disabled={addMut.isPending}
              aria-label="Agregar"
            >
              <Plus className="size-4" />
            </Button>
          </form>
        </Form>
      )}
    </div>
  );
}
