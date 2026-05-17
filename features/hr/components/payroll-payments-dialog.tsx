"use client";

import { Loader2, Trash2 } from "lucide-react";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useScope } from "@/components/providers/scope-provider";
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
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";
import { formatArgentineDate } from "@/lib/format";

import {
  useCreatePayrollPayment,
  useDeletePayrollPayment,
  usePayrollPayments,
} from "../hooks/use-payroll-payments";
import {
  PAYROLL_PAYMENT_METHOD_LABEL,
  PAYROLL_PAYMENT_METHODS,
  type PayrollPaymentMethod,
} from "../payroll-schema";

import { formatMoney as money } from "@/lib/format";

type Props = {
  entryId: string;
  employeeName: string;
  total: number;
  paid: number;
  saldo: number;
  year: number;
  month: number;
  disabled: boolean;
};

export function PayrollPaymentsDialog({
  entryId,
  employeeName,
  total,
  paid,
  saldo,
  year,
  month,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 px-2 font-mono text-xs"
      title={`Pagado ${money(paid)} / Total ${money(total)}`}
    >
      {saldo === 0 ? (
        <span className="text-emerald-600 dark:text-emerald-400">
          {money(saldo)}
        </span>
      ) : saldo > 0 ? (
        <span className="text-amber-600 dark:text-amber-400">
          {money(saldo)}
        </span>
      ) : (
        <span className="text-rose-600 dark:text-rose-400">
          {money(saldo)}
        </span>
      )}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Pagos — {employeeName}</DialogTitle>
          <DialogDescription>
            Total {money(total)} · Pagado {money(paid)} · Saldo {money(saldo)}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <Suspense
            fallback={
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Cargando…
              </div>
            }
          >
            <PaymentsBody
              entryId={entryId}
              year={year}
              month={month}
              saldo={saldo}
              disabled={disabled}
            />
          </Suspense>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type AddValues = {
  account_id: string;
  channel_id: string;
  amount: string;
  method: PayrollPaymentMethod;
  paid_at: string;
  notes: string;
};

function PaymentsBody({
  entryId,
  year,
  month,
  saldo,
  disabled,
}: {
  entryId: string;
  year: number;
  month: number;
  saldo: number;
  disabled: boolean;
}) {
  const { data: payments = [], isLoading } = usePayrollPayments(entryId);
  const { data: accounts } = useAccountsList();
  const { channels } = useScope();
  const createMut = useCreatePayrollPayment();
  const deleteMut = useDeletePayrollPayment();

  const activeAccounts = (accounts ?? []).filter((a) => a.is_active);
  const activeChannels = channels.filter((c) => c.is_active);

  const form = useForm<AddValues>({
    defaultValues: {
      account_id: activeAccounts[0]?.id ?? "",
      channel_id: activeChannels[0]?.id ?? "",
      amount: saldo > 0 ? String(saldo) : "",
      method: "transferencia",
      paid_at: new Date().toISOString().slice(0, 10),
      notes: "",
    },
  });

  function onAdd(values: AddValues) {
    const amount = Number(values.amount.replace(/,/g, "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Monto inválido.");
      return;
    }
    if (!values.account_id || !values.channel_id) {
      toast.error("Faltan cuenta y canal.");
      return;
    }
    createMut.mutate(
      {
        entry_id: entryId,
        account_id: values.account_id,
        channel_id: values.channel_id,
        amount,
        method: values.method,
        paid_at: values.paid_at,
        notes: values.notes || null,
        period_year: year,
        period_month: month,
      },
      {
        onSuccess: () => {
          toast.success("Pago registrado.");
          form.reset({
            ...form.getValues(),
            amount: "",
            notes: "",
          });
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function onDelete(id: string) {
    deleteMut.mutate(
      { id, entry_id: entryId, period_year: year, period_month: month },
      {
        onSuccess: () => toast.success("Pago eliminado."),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-1.5">
        {isLoading ? (
          <li className="text-sm text-muted-foreground">Cargando…</li>
        ) : payments.length === 0 ? (
          <li className="text-sm text-muted-foreground">Sin pagos todavía.</li>
        ) : (
          payments.map((payment) => {
            const account = activeAccounts.find((a) => a.id === payment.account_id);
            return (
              <li
                key={payment.id}
                className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
              >
                <div className="flex-1">
                  <div className="font-medium">
                    {formatArgentineDate(payment.paid_at)} ·{" "}
                    {PAYROLL_PAYMENT_METHOD_LABEL[payment.method]}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {account?.name ?? "(cuenta)"}
                    {payment.notes ? ` · ${payment.notes}` : ""}
                  </div>
                </div>
                <span className="font-mono">{money(Number(payment.amount))}</span>
                {!disabled && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => onDelete(payment.id)}
                    disabled={deleteMut.isPending}
                    aria-label="Borrar"
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                )}
              </li>
            );
          })
        )}
      </ul>

      {!disabled && activeAccounts.length > 0 && activeChannels.length > 0 && (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onAdd)}
            className="grid grid-cols-2 gap-3 border-t pt-4"
          >
            <FormField
              control={form.control}
              name="account_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cuenta</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {activeAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="channel_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Canal</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {activeChannels.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Método</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PAYROLL_PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {PAYROLL_PAYMENT_METHOD_LABEL[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="paid_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha</FormLabel>
                  <FormControl>
                    <Input {...field} type="date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monto</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode="decimal"
                      className="text-right font-mono"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="col-span-2 flex justify-end">
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending ? "Registrando…" : "Registrar pago"}
              </Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  );
}
