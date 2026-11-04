"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { DialogFormFooter } from "@/components/dialog-form-footer";
import { MoneyInput } from "@/components/money-input";
import {
  Form,
  FormControl,
  FormDescription,
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
import { parseArAmount, signedAmountToInput } from "@/lib/format";

import {
  useAccountHasMovements,
  useCreateAccount,
  useUpdateAccount,
} from "../hooks/use-accounts";
import {
  ACCOUNT_CURRENCIES,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABEL,
  type Account,
} from "../schema";

type Mode = "create" | "edit";

const FormSchema = z.object({
  name: z.string().trim().min(2, "Nombre requerido.").max(120),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.enum(ACCOUNT_CURRENCIES),
  opening_balance: z
    .string()
    .refine(
      (v) => v.trim() === "" || parseArAmount(v) !== null,
      "Saldo inicial inválido.",
    ),
  notes: z.string().trim().max(2000),
});

type FormValues = z.infer<typeof FormSchema>;

function accountToValues(account: Account | undefined): FormValues {
  return {
    name: account?.name ?? "",
    type: account?.type ?? "bank",
    currency: account?.currency ?? "ARS",
    opening_balance:
      account?.opening_balance != null
        ? signedAmountToInput(account.opening_balance)
        : "0",
    notes: account?.notes ?? "",
  };
}

export function AccountForm({
  mode,
  account,
  onSuccess,
  onCancel,
}: {
  mode: Mode;
  account?: Account;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const createMut = useCreateAccount();
  const updateMut = useUpdateAccount();
  const isSaving = createMut.isPending || updateMut.isPending;
  // guard_account_currency_change freezes currency, type and opening balance
  // once the account has movements. Locked until the answer arrives, and
  // when it can't be read.
  const movements = useAccountHasMovements(
    account?.id ?? "",
    mode === "edit" && account !== undefined,
  );
  const frozen = mode === "edit" && movements.data !== false;

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: accountToValues(account),
  });

  function onSubmit(raw: FormValues) {
    // Empty means no opening balance, as on the server.
    const values = {
      ...raw,
      opening_balance: parseArAmount(raw.opening_balance) ?? 0,
    };
    if (mode === "create") {
      createMut.mutate(values, {
        onSuccess: (data) => {
          toast.success("Cuenta creada.");
          onSuccess?.(data.id);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (account) {
      const { type, currency, opening_balance, ...editable } = values;
      updateMut.mutate(
        {
          id: account.id,
          ...editable,
          ...(!frozen && { type, currency, opening_balance }),
        },
        {
          onSuccess: () => {
            toast.success("Cambios guardados.");
            onSuccess?.(account.id);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete="off"
                  placeholder="Caja Chica, Galicia ARS, Mercado Pago…"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tipo</FormLabel>
                <FormControl>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={frozen}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {ACCOUNT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {ACCOUNT_TYPE_LABEL[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="currency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Moneda</FormLabel>
                <FormControl>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={frozen}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {ACCOUNT_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="opening_balance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Saldo inicial</FormLabel>
              <FormControl>
                <MoneyInput
                  {...field}
                  allowNegative
                  placeholder="0,00"
                  className="sm:max-w-[240px]"
                  disabled={frozen}
                />
              </FormControl>
              {frozen && (
                <FormDescription>
                  {movements.isPending
                    ? "Revisando si la cuenta tiene movimientos…"
                    : movements.isError
                      ? "No se pudo saber si la cuenta tiene movimientos: tipo, moneda y saldo inicial quedan sin cambios."
                      : 'La cuenta tiene movimientos: tipo, moneda y saldo inicial ya no se cambian. Para corregir el saldo, usá "Ajustar saldo".'}
                </FormDescription>
              )}
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
                <Textarea {...field} rows={3} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFormFooter
          mode={mode}
          isSaving={isSaving}
          isDirty={form.formState.isDirty}
          createLabel="Crear cuenta"
          onCancel={() => onCancel?.()}
        />
      </form>
    </Form>
  );
}
