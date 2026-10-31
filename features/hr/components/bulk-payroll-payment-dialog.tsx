"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";
import { formatMoney, todayInAR } from "@/lib/format";

import { useBulkCreatePayrollPayments } from "../hooks/use-payroll-payments";
import {
  PAYROLL_PAYMENT_METHOD_LABEL,
  PAYROLL_PAYMENT_METHODS,
  type PayrollPaymentMethod,
} from "../payroll-schema";

type EmployeeOption = {
  entry_id: string;
  employee_id: string;
  employee_name: string;
  saldo: number;
};

type ChannelOption = { id: string; name: string };

const FormSchema = z.object({
  account_id: z.string().uuid("Seleccioná una cuenta."),
  channel_id: z.string().min(1, "Canal requerido."),
  amount_each: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Monto inválido (ej. 500000)."),
  method: z.enum(PAYROLL_PAYMENT_METHODS),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  notes: z.string().trim().max(500).optional(),
});

type FormValues = z.infer<typeof FormSchema>;

export function BulkPayrollPaymentDialog({
  employees,
  channels,
  year,
  month,
  disabled,
}: {
  employees: EmployeeOption[];
  channels: ChannelOption[];
  year: number;
  month: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data: accountsData } = useAccountsList();
  const activeAccounts = useMemo(
    () => (accountsData ?? []).filter((a) => a.is_active),
    [accountsData],
  );
  const mut = useBulkCreatePayrollPayments();
  const defaultChannel = useDefaultChannel() ?? "";

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      account_id: activeAccounts[0]?.id ?? "",
      channel_id: defaultChannel,
      amount_each: "",
      method: "transferencia" as PayrollPaymentMethod,
      paid_at: todayInAR(),
      notes: "",
    },
  });

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      return;
    }
    // Pre-select everyone with a balance > 0.
    setSelected(
      new Set(employees.filter((e) => e.saldo > 0).map((e) => e.entry_id)),
    );
    form.reset({
      account_id: activeAccounts[0]?.id ?? "",
      channel_id: defaultChannel,
      amount_each: "",
      method: "transferencia",
      paid_at: todayInAR(),
      notes: "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedCount = selected.size;
  const amountEach = Number(form.watch("amount_each") || 0);
  const totalAmount = selectedCount * amountEach;

  function toggleEmployee(entryId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(entryId);
      else next.delete(entryId);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelected(new Set(employees.map((e) => e.entry_id)));
    } else {
      setSelected(new Set());
    }
  }

  function onSubmit(values: FormValues) {
    if (selectedCount === 0) {
      toast.error("Seleccioná al menos un empleado.");
      return;
    }
    mut.mutate(
      {
        entry_ids: [...selected],
        account_id: values.account_id,
        channel_id: values.channel_id,
        amount_each: Number(values.amount_each),
        method: values.method,
        paid_at: values.paid_at,
        notes: values.notes?.trim() ? values.notes : null,
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
            Transferí el mismo monto a varios empleados de una. Se genera un
            pago + transaction de caja por cada uno.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Employee selector */}
            <div className="rounded-md border">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={
                      selectedCount === employees.length && employees.length > 0
                    }
                    onCheckedChange={(v) => toggleAll(Boolean(v))}
                  />
                  Empleados ({selectedCount}/{employees.length})
                </Label>
                <span className="text-xs text-muted-foreground">
                  Saldo actual
                </span>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {employees.map((e) => (
                  <label
                    key={e.entry_id}
                    className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selected.has(e.entry_id)}
                        onCheckedChange={(v) =>
                          toggleEmployee(e.entry_id, Boolean(v))
                        }
                      />
                      <span>{e.employee_name}</span>
                    </div>
                    <span
                      className={`font-mono text-xs ${
                        e.saldo > 0
                          ? "text-muted-foreground dark:text-muted-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {formatMoney(e.saldo)}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="amount_each"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monto por empleado</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="500000"
                        {...field}
                      />
                    </FormControl>
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

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="account_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cuenta</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Cuenta" />
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
                name="method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Método</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
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
            </div>

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

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Ej. transferencia consolidada 15 mayo"
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
                  {selectedCount} empleado{selectedCount !== 1 ? "s" : ""} ×{" "}
                  {formatMoney(amountEach)}
                </span>
                <span className="font-mono font-medium">
                  Total: {formatMoney(totalAmount)}
                </span>
              </div>
            </div>

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
                disabled={mut.isPending || selectedCount === 0}
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
