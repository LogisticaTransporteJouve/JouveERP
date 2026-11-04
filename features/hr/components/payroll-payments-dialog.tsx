"use client";

import { Loader2, Pencil, RotateCw, Trash2 } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import {
  useDefaultChannel,
  useScope,
} from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { MoneyInput } from "@/components/money-input";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountOptionsError } from "@/features/accounts/components/account-options-gate";
import { useAccountOptions } from "@/features/accounts/hooks/use-accounts";
import {
  amountToInput,
  formatArgentineDate,
  parseArAmount,
  todayInAR,
} from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  useCreatePayrollPayment,
  useDeletePayrollPayment,
  usePayrollPayments,
  useUpdatePayrollPayment,
} from "../hooks/use-payroll-payments";
import {
  exceedsBalance,
  payrollPayableAccounts,
} from "../lib/payroll-payments";
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
  /** Why the payments are read-only, shown in the dialog. */
  disabledReason?: string | null;
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
  disabledReason = null,
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
        <span className="text-muted-foreground dark:text-muted-foreground">
          {money(saldo)}
        </span>
      ) : saldo > 0 ? (
        <span className="text-muted-foreground dark:text-muted-foreground">
          {money(saldo)}
        </span>
      ) : (
        <span className="text-foreground dark:text-foreground">
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
          {disabled && disabledReason && (
            <p className="text-xs text-muted-foreground">{disabledReason}</p>
          )}
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
  allow_overpay: boolean;
};

type PaymentsBodyProps = {
  entryId: string;
  year: number;
  month: number;
  saldo: number;
  disabled: boolean;
};

/** The payments already made always list, with delete. Adding or editing one
 *  picks an account: without accounts (a per-user deny of accounts:read, or a
 *  failed read) the form says why instead. */
function PaymentsBody({
  entryId,
  year,
  month,
  saldo,
  disabled,
}: PaymentsBodyProps) {
  const {
    accounts,
    error: accountsError,
    pending: accountsPending,
    retry: retryAccounts,
  } = useAccountOptions();
  const canPickAccount = !accountsError && !accountsPending;
  const {
    data: paymentsData,
    isLoading,
    isError: paymentsFailed,
    refetch: refetchPayments,
  } = usePayrollPayments(entryId);
  const payments = paymentsData ?? [];
  const { channels } = useScope();
  const defaultChannel = useDefaultChannel();
  const createMut = useCreatePayrollPayment();
  const updateMut = useUpdatePayrollPayment();
  const deleteMut = useDeletePayrollPayment();
  const [editingId, setEditingId] = useState<string | null>(null);

  const payableAccounts = payrollPayableAccounts(accounts);
  const activeChannels = channels.filter((c) => c.is_active);
  const editing = payments.find((p) => p.id === editingId) ?? null;

  const emptyValues: AddValues = {
    account_id: payableAccounts[0]?.id ?? "",
    channel_id: defaultChannel ?? "",
    amount: saldo > 0 ? amountToInput(saldo) : "",
    method: "transferencia",
    paid_at: todayInAR(),
    notes: "",
    allow_overpay: false,
  };
  const form = useForm<AddValues>({ defaultValues: emptyValues });

  // The accounts may arrive after the form mounted (a cold cache, or
  // «Reintentar» after a failed read): default to the first, as the bulk
  // dialog does.
  const firstAccountId = payableAccounts[0]?.id ?? "";
  useEffect(() => {
    if (firstAccountId && !editingId && !form.getValues("account_id")) {
      form.setValue("account_id", firstAccountId);
    }
  }, [firstAccountId, editingId, form]);

  // Editing a payment frees its own amount, so it counts toward the balance.
  const available = saldo + (editing ? Number(editing.amount) : 0);
  const typedAmount = parseArAmount(
    useWatch({ control: form.control, name: "amount" }),
  );
  const overpays =
    typedAmount !== null && exceedsBalance(typedAmount, available);

  function startEdit(id: string) {
    const payment = payments.find((p) => p.id === id);
    if (!payment) return;
    setEditingId(id);
    form.reset({
      account_id: payment.account_id,
      channel_id: payment.channel_id,
      amount: amountToInput(Number(payment.amount)),
      method: payment.method,
      paid_at: payment.paid_at,
      notes: payment.notes ?? "",
      allow_overpay: false,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    form.reset({ ...emptyValues, amount: "" });
  }

  function onSubmit(values: AddValues) {
    const amount = parseArAmount(values.amount);
    if (amount === null || amount <= 0) {
      toast.error("Monto inválido.");
      return;
    }
    if (!values.account_id || !values.channel_id) {
      toast.error("Faltan cuenta y canal.");
      return;
    }
    const payload = {
      account_id: values.account_id,
      channel_id: values.channel_id,
      amount,
      method: values.method,
      paid_at: values.paid_at,
      notes: values.notes || null,
      allow_overpay: values.allow_overpay,
      entry_id: entryId,
      period_year: year,
      period_month: month,
    };
    if (editing) {
      updateMut.mutate(
        { ...payload, id: editing.id },
        {
          onSuccess: () => {
            toast.success("Pago actualizado.");
            cancelEdit();
          },
          onError: (err) => toast.error(err.message),
        },
      );
      return;
    }
    createMut.mutate(payload, {
      onSuccess: () => {
        toast.success("Pago registrado.");
        form.reset({
          ...form.getValues(),
          amount: "",
          notes: "",
          allow_overpay: false,
        });
      },
      onError: (err) => toast.error(err.message),
    });
  }

  function onDelete(id: string) {
    deleteMut.mutate(
      { id, entry_id: entryId, period_year: year, period_month: month },
      {
        onSuccess: () => {
          toast.success("Pago eliminado.");
          if (id === editingId) cancelEdit();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-4">
      <ul className="space-y-1.5">
        {isLoading ? (
          <li className="text-sm text-muted-foreground">Cargando…</li>
        ) : paymentsFailed && !paymentsData ? (
          <li
            role="alert"
            className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
          >
            <span>No se pudieron cargar los pagos.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetchPayments()}
            >
              <RotateCw />
              Reintentar
            </Button>
          </li>
        ) : payments.length === 0 ? (
          <li className="text-sm text-muted-foreground">Sin pagos todavía.</li>
        ) : (
          payments.map((payment) => {
            const account = accounts.find((a) => a.id === payment.account_id);
            return (
              <li
                key={payment.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm",
                  payment.id === editingId && "border-primary",
                )}
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
                <span className="font-mono">
                  {money(Number(payment.amount))}
                </span>
                {!disabled && (
                  <>
                    {canPickAccount && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => startEdit(payment.id)}
                        disabled={saving || deleteMut.isPending}
                        aria-label="Editar pago"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => onDelete(payment.id)}
                      disabled={deleteMut.isPending}
                      aria-label="Borrar pago"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </li>
            );
          })
        )}
      </ul>

      {!disabled && accountsPending && (
        <p className="border-t pt-4 text-sm text-muted-foreground">
          Cargando cuentas…
        </p>
      )}

      {!disabled && !accountsPending && accountsError && (
        <AccountOptionsError
          message={accountsError}
          onRetry={retryAccounts}
          className="justify-start border-t pt-4"
        />
      )}

      {!disabled && canPickAccount && payableAccounts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No hay cuentas activas en pesos para pagar sueldos. Creá o activá una
          caja o banco en ARS en Tesorería.
        </p>
      )}

      {!disabled &&
        canPickAccount &&
        payableAccounts.length > 0 &&
        activeChannels.length > 0 && (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
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
                        {payableAccounts.map((a) => (
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
                      <MoneyInput {...field} className="text-right font-mono" />
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
              {overpays && (
                <FormField
                  control={form.control}
                  name="allow_overpay"
                  render={({ field }) => (
                    <FormItem className="col-span-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(v) => field.onChange(v === true)}
                          />
                        </FormControl>
                        <FormLabel className="font-normal">
                          Pagar más que el saldo
                        </FormLabel>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        El monto supera el saldo pendiente (
                        {money(Math.max(available, 0))}). Marcalo solo si es un
                        adelanto o un pago a cuenta del mes siguiente.
                      </p>
                    </FormItem>
                  )}
                />
              )}
              <div className="col-span-2 flex justify-end gap-2">
                {editing && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={cancelEdit}
                    disabled={saving}
                  >
                    Cancelar
                  </Button>
                )}
                <Button type="submit" disabled={saving}>
                  {editing
                    ? updateMut.isPending
                      ? "Guardando…"
                      : "Guardar cambios"
                    : createMut.isPending
                      ? "Registrando…"
                      : "Registrar pago"}
                </Button>
              </div>
            </form>
          </Form>
        )}
    </div>
  );
}
