"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import { Textarea } from "@/components/ui/textarea";
import { todayInAR } from "@/lib/format";
import type { Account } from "@/features/accounts/schema";
import {
  SupplierPicker,
  type PickedSupplier,
} from "@/features/suppliers/components/supplier-picker";

import {
  useCreateIssuedCheck,
  useUpdateIssuedCheck,
} from "../hooks/use-issued-checks";
import {
  ISSUED_CHECK_CURRENCIES,
  ISSUED_CHECK_KINDS,
  ISSUED_CHECK_KIND_LABEL,
  type IssuedCheck,
  type IssuedCheckCurrency,
  type IssuedCheckKind,
} from "../schema";

type Mode = "create" | "edit";

const FormSchema = z.object({
  kind: z.enum(ISSUED_CHECK_KINDS),
  check_number: z.string().trim().min(1, "Número requerido."),
  bank_name: z.string().trim().min(1, "Banco requerido."),
  beneficiary_name: z.string().trim().max(120),
  beneficiary_cuit: z.string().trim().max(20),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Monto requerido."),
  currency: z.enum(ISSUED_CHECK_CURRENCIES),
  bank_account_id: z.string().uuid("Cuenta bancaria requerida."),
  supplier: z.custom<PickedSupplier>().nullable(),
  notes: z.string().trim().max(500),
});

type FormValues = z.infer<typeof FormSchema>;

function toValues(
  c: IssuedCheck | undefined,
  defaultAccountId: string,
  prefill?: PickedSupplier | null,
): FormValues {
  return {
    kind: c?.kind ?? "fisico",
    check_number: c?.check_number ?? "",
    bank_name: c?.bank_name ?? "",
    beneficiary_name: c?.beneficiary_name ?? "",
    beneficiary_cuit: c?.beneficiary_cuit ?? "",
    issue_date: c?.issue_date ?? todayInAR(),
    due_date: c?.due_date ?? todayInAR(),
    amount: c ? String(c.amount) : "",
    currency: c?.currency ?? "ARS",
    bank_account_id: c?.bank_account_id ?? defaultAccountId,
    supplier: prefill ?? null,
    notes: c?.notes ?? "",
  };
}

export function IssuedCheckForm({
  mode,
  check,
  accounts,
  initialSupplier,
  onSuccess,
  onCancel,
}: {
  mode: Mode;
  check?: IssuedCheck;
  accounts: Account[];
  initialSupplier?: PickedSupplier | null;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const createMut = useCreateIssuedCheck();
  const updateMut = useUpdateIssuedCheck();
  const isSaving = createMut.isPending || updateMut.isPending;

  const bankAccounts = accounts.filter(
    (a) => a.is_active && a.type === "bank",
  );
  const defaultAccountId = check?.bank_account_id ?? bankAccounts[0]?.id ?? "";

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toValues(check, defaultAccountId, initialSupplier),
  });

  function onSubmit(values: FormValues) {
    const payload = {
      kind: values.kind,
      check_number: values.check_number.trim(),
      bank_name: values.bank_name.trim(),
      beneficiary_name: values.beneficiary_name.trim() || null,
      beneficiary_cuit: values.beneficiary_cuit.trim() || null,
      issue_date: values.issue_date,
      due_date: values.due_date,
      amount: values.amount,
      currency: values.currency,
      bank_account_id: values.bank_account_id,
      supplier_id: values.supplier?.id ?? null,
      notes: values.notes.trim() || null,
    };

    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: (data) => {
          toast.success("Cheque cargado.");
          if (onSuccess) onSuccess(data.id);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (check) {
      updateMut.mutate(
        { id: check.id, ...payload },
        {
          onSuccess: () => {
            toast.success("Cheque actualizado.");
            if (onSuccess) onSuccess(check.id);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="kind"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">Tipo</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(v) => field.onChange(v as IssuedCheckKind)}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ISSUED_CHECK_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {ISSUED_CHECK_KIND_LABEL[k]}
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
            name="check_number"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">Número</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="12345678" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="bank_name"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">Banco</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Banco Galicia" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="bank_account_id"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-xs">
                Cuenta bancaria (chequera)
              </FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Elegir cuenta" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {bankAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="issue_date"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">Fecha de emisión</FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="due_date"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">Fecha de cobro</FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">Monto</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="0,00"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="currency"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">Moneda</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(v) =>
                    field.onChange(v as IssuedCheckCurrency)
                  }
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ISSUED_CHECK_CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
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
          name="supplier"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-xs">Beneficiario (proveedor)</FormLabel>
              <FormControl>
                <SupplierPicker
                  value={field.value}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="beneficiary_name"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">
                  Nombre del beneficiario (opcional)
                </FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Si difiere del proveedor" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="beneficiary_cuit"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">
                  CUIT beneficiario (opcional)
                </FormLabel>
                <FormControl>
                  <Input {...field} placeholder="30-12345678-9" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-xs">Notas</FormLabel>
              <FormControl>
                <Textarea rows={2} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onCancel?.()}
            disabled={isSaving}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving
              ? "Guardando…"
              : mode === "create"
                ? "Cargar cheque"
                : "Guardar cambios"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
