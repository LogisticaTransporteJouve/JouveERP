"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useDefaultChannel } from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AccountOptionsError } from "@/features/accounts/components/account-options-gate";
import { useAccountOptions } from "@/features/accounts/hooks/use-accounts";
import {
  amountToInput,
  formatMoney,
  parseArAmount,
  todayInAR,
} from "@/lib/format";

import { useBulkCreatePayrollPayments } from "../hooks/use-payroll-payments";
import {
  exceedsBalance,
  payrollPayableAccounts,
} from "../lib/payroll-payments";
import { suggestedPayment } from "../lib/payroll-split";
import {
  isPayrollPaymentMethod,
  PAYROLL_PAYMENT_METHOD_LABEL,
  PAYROLL_PAYMENT_METHODS,
  type PayrollEntryResolved,
  type PayrollPaymentMethod,
} from "../payroll-schema";

type ChannelOption = { id: string; name: string };

const FormSchema = z.object({
  account_id: z.string().uuid("Seleccioná una cuenta."),
  channel_id: z.string().min(1, "Canal requerido."),
  method: z.enum(PAYROLL_PAYMENT_METHODS),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  notes: z.string().trim().max(500).optional(),
});

type FormValues = z.infer<typeof FormSchema>;

/** Suggested amount per entry for a method, as an editable string. */
function suggestedAmounts(
  entries: readonly PayrollEntryResolved[],
  method: PayrollPaymentMethod,
): Record<string, string> {
  return Object.fromEntries(
    entries.map((e) => {
      const amount = suggestedPayment(e, method);
      return [e.id, amount > 0 ? amountToInput(amount) : ""];
    }),
  );
}

function parseAmount(raw: string | undefined): number | null {
  const value = parseArAmount(raw ?? "");
  return value !== null && value > 0 ? value : null;
}

export function BulkPayrollPaymentDialog({
  entries,
  channels,
  year,
  month,
  disabled,
}: {
  entries: PayrollEntryResolved[];
  channels: ChannelOption[];
  year: number;
  month: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // Read once opened, never thrown: the button is mounted on the payroll
  // month, which must not fall over when accounts cannot be read.
  const {
    accounts: accountsData,
    error: accountsError,
    retry: retryAccounts,
  } = useAccountOptions(open);
  const payableAccounts = useMemo(
    () => payrollPayableAccounts(accountsData),
    [accountsData],
  );
  const [allowOverpay, setAllowOverpay] = useState(false);
  const mut = useBulkCreatePayrollPayments();
  const defaultChannel = useDefaultChannel() ?? "";

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      account_id: payableAccounts[0]?.id ?? "",
      channel_id: defaultChannel,
      method: "transferencia",
      paid_at: todayInAR(),
      notes: "",
    },
  });
  const method = useWatch({ control: form.control, name: "method" });

  // Each method suggests its own share (transfer = receipt net − garnishment
  // − discounts; cash = the rest); switching it re-suggests every amount.
  function applySuggestions(next: PayrollPaymentMethod) {
    const suggested = suggestedAmounts(entries, next);
    setAmounts(suggested);
    setSelected(
      new Set(entries.filter((e) => suggested[e.id] !== "").map((e) => e.id)),
    );
  }

  useEffect(() => {
    setAllowOverpay(false);
    if (!open) {
      setSelected(new Set());
      setAmounts({});
      return;
    }
    form.reset({
      account_id: payableAccounts[0]?.id ?? "",
      channel_id: defaultChannel,
      method: "transferencia",
      paid_at: todayInAR(),
      notes: "",
    });
    applySuggestions("transferencia");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The accounts may arrive after the dialog opened: default to the first.
  const firstAccountId = payableAccounts[0]?.id ?? "";
  useEffect(() => {
    if (open && firstAccountId && !form.getValues("account_id")) {
      form.setValue("account_id", firstAccountId);
    }
  }, [open, firstAccountId, form]);

  const selectedEntries = entries.filter((e) => selected.has(e.id));
  const invalidCount = selectedEntries.filter(
    (e) => parseAmount(amounts[e.id]) === null,
  ).length;
  const totalAmount = selectedEntries.reduce(
    (sum, e) => sum + (parseAmount(amounts[e.id]) ?? 0),
    0,
  );
  const overpaidCount = selectedEntries.filter((e) => {
    const amount = parseAmount(amounts[e.id]);
    return amount !== null && exceedsBalance(amount, e.saldo);
  }).length;
  const selectedCount = selected.size;

  function toggleEmployee(entryId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(entryId);
      else next.delete(entryId);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(entries.map((e) => e.id)) : new Set());
  }

  function onSubmit(values: FormValues) {
    if (selectedCount === 0) {
      toast.error("Seleccioná al menos un empleado.");
      return;
    }
    const items: { entry_id: string; amount: number }[] = [];
    for (const e of selectedEntries) {
      const amount = parseAmount(amounts[e.id]);
      if (amount === null) {
        toast.error("Completá un monto válido para cada empleado elegido.");
        return;
      }
      items.push({ entry_id: e.id, amount });
    }
    mut.mutate(
      {
        items,
        account_id: values.account_id,
        channel_id: values.channel_id,
        method: values.method,
        paid_at: values.paid_at,
        notes: values.notes?.trim() ? values.notes : null,
        allow_overpay: allowOverpay,
        period_year: year,
        period_month: month,
      },
      {
        onSuccess: (res) => {
          toast.success(`${res.inserted} pago(s) registrado(s).`);
          setOpen(false);
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Error"),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Users className="size-4" />
          Pago masivo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pago masivo de sueldos</DialogTitle>
          <DialogDescription>
            Un pago por empleado, cada uno con su monto. Con el neto del recibo
            cargado se sugiere la transferencia (recibo − embargo − descuentos)
            o el efectivo (el resto); sin recibo, el saldo.
          </DialogDescription>
        </DialogHeader>
        {open && accountsError && (
          <AccountOptionsError
            message={accountsError}
            onRetry={retryAccounts}
            className="justify-start"
          />
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Método</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        if (!isPayrollPaymentMethod(v)) return;
                        field.onChange(v);
                        applySuggestions(v);
                      }}
                    >
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
                      <DatePicker
                        value={field.value || ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="rounded-md border">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={
                      selectedCount === entries.length && entries.length > 0
                    }
                    onCheckedChange={(v) => toggleAll(Boolean(v))}
                  />
                  Empleados ({selectedCount}/{entries.length})
                </Label>
                <span className="text-xs text-muted-foreground">
                  Saldo · {PAYROLL_PAYMENT_METHOD_LABEL[method]}
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {entries.map((e) => {
                  const isSelected = selected.has(e.id);
                  const amount = parseAmount(amounts[e.id]);
                  const over =
                    isSelected &&
                    amount !== null &&
                    exceedsBalance(amount, e.saldo);
                  return (
                    <div
                      key={e.id}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
                    >
                      <Label className="flex min-w-0 flex-1 items-center gap-2 font-normal">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(v) =>
                            toggleEmployee(e.id, Boolean(v))
                          }
                        />
                        <span className="truncate">
                          {e.employee_legal_name}
                        </span>
                      </Label>
                      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                        {formatMoney(e.saldo)}
                      </span>
                      <MoneyInput
                        aria-label={`Monto para ${e.employee_legal_name}`}
                        className="h-8 w-32 text-right font-mono"
                        value={amounts[e.id] ?? ""}
                        disabled={!isSelected}
                        aria-invalid={isSelected && (amount === null || over)}
                        onChange={(value) =>
                          setAmounts((prev) => ({ ...prev, [e.id]: value }))
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="account_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cuenta en pesos</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Cuenta" />
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
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {channels.map((c) => (
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
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Ej. transferencias del día 5"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {selectedCount} empleado{selectedCount !== 1 ? "s" : ""}
                  {invalidCount > 0
                    ? ` · ${invalidCount} sin monto válido`
                    : ""}
                </span>
                <span className="font-mono font-medium">
                  Total: {formatMoney(totalAmount)}
                </span>
              </div>
            </div>

            {overpaidCount > 0 && (
              <div className="space-y-1 rounded-md border px-3 py-2 text-sm">
                <p>
                  {overpaidCount} empleado(s) quedarían con saldo negativo con
                  el monto cargado.
                </p>
                <Label className="flex items-center gap-2 font-normal">
                  <Checkbox
                    checked={allowOverpay}
                    onCheckedChange={(v) => setAllowOverpay(v === true)}
                  />
                  Pagar más que el saldo
                </Label>
              </div>
            )}

            {payableAccounts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No hay cuentas activas en pesos para pagar sueldos.
              </p>
            )}

            <DialogFooter className="flex-row justify-end gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={mut.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  mut.isPending || selectedCount === 0 || invalidCount > 0
                }
              >
                {mut.isPending
                  ? "Registrando…"
                  : `Registrar ${selectedCount} pago${selectedCount !== 1 ? "s" : ""}`}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
