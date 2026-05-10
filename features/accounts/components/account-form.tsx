"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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

import {
  createAccountAction,
  updateAccountAction,
} from "../actions/accounts-actions";
import {
  ACCOUNT_CURRENCIES,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABEL,
  type Account,
  type AccountCurrency,
  type AccountType,
} from "../schema";

type Mode = "create" | "edit";

type FormValues = {
  name: string;
  type: AccountType;
  currency: AccountCurrency;
  opening_balance: string;
  notes: string;
};

function accountToValues(account: Account | undefined): FormValues {
  return {
    name: account?.name ?? "",
    type: account?.type ?? "bank",
    currency: account?.currency ?? "ARS",
    opening_balance:
      account?.opening_balance != null ? String(account.opening_balance) : "0",
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
  const router = useRouter();
  const [isSaving, startSaving] = useTransition();

  const form = useForm<FormValues>({
    defaultValues: accountToValues(account),
  });

  function onSubmit(values: FormValues) {
    startSaving(async () => {
      if (mode === "create") {
        const res = await createAccountAction(values);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Cuenta creada.");
        if (onSuccess) onSuccess(res.data.id);
        router.refresh();
      } else if (account) {
        const res = await updateAccountAction({ id: account.id, ...values });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Cambios guardados.");
        if (onSuccess) onSuccess(account.id);
        router.refresh();
      }
    });
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
                  <Select value={field.value} onValueChange={field.onChange}>
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
                  <Select value={field.value} onValueChange={field.onChange}>
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
                <Input
                  {...field}
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="sm:max-w-[240px]"
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
                <Textarea {...field} rows={3} />
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
          <Button
            type="submit"
            disabled={
              isSaving || (mode === "edit" && !form.formState.isDirty)
            }
          >
            {isSaving
              ? "Guardando…"
              : mode === "create"
                ? "Crear cuenta"
                : "Guardar cambios"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
