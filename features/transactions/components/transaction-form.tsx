"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useDefaultChannel } from "@/components/providers/scope-provider";
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
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";

import {
  useCreateTransaction,
  useCreateTransfer,
} from "../hooks/use-transactions";
import { defaultAccrualMonth, TRANSACTION_CURRENCIES } from "../schema";

export interface ChannelOption {
  id: string;
  name: string;
}

const FormSchema = z
  .object({
    kind: z.enum(["income", "expense", "transfer"]),
    channel_id: z.string().min(1, "Canal requerido."),
    account_id: z.string().optional(),
    account_from_id: z.string().optional(),
    account_to_id: z.string().optional(),
    amount: z.string().regex(/^\d+(\.\d+)?$/, "Monto requerido."),
    currency: z.enum(TRANSACTION_CURRENCIES),
    transaction_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
    accrual_month: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Mes devengado inválido."),
    description: z.string().trim().max(500),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "transfer") {
      if (!data.account_from_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["account_from_id"],
          message: "Cuenta origen requerida.",
        });
      }
      if (!data.account_to_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["account_to_id"],
          message: "Cuenta destino requerida.",
        });
      }
      if (
        data.account_from_id &&
        data.account_to_id &&
        data.account_from_id === data.account_to_id
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["account_to_id"],
          message: "Origen y destino deben ser distintos.",
        });
      }
    } else {
      if (!data.account_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["account_id"],
          message: "Cuenta requerida.",
        });
      }
    }
  });

type FormValues = z.infer<typeof FormSchema>;

export function TransactionForm({
  channels,
  onSuccess,
  onCancel,
}: {
  channels: ChannelOption[];
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const { data: accounts } = useAccountsList();
  const activeAccounts = accounts.filter(
    (a) => a.is_active && a.type !== "checks" && a.type !== "echeq",
  );

  const createTxMut = useCreateTransaction();
  const createTransferMut = useCreateTransfer();
  const isSaving = createTxMut.isPending || createTransferMut.isPending;

  const defaultChannel = useDefaultChannel() ?? "";
  const today = todayInAR();

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      kind: "income",
      channel_id: defaultChannel,
      account_id: "",
      account_from_id: "",
      account_to_id: "",
      amount: "",
      currency: "ARS",
      transaction_date: today,
      accrual_month: defaultAccrualMonth(today),
      description: "",
    },
  });

  const kind = useWatch({ control: form.control, name: "kind" });
  const accountFromId = useWatch({
    control: form.control,
    name: "account_from_id",
  });

  function onSubmit(values: FormValues) {
    if (values.kind === "transfer") {
      const fromAcc = activeAccounts.find(
        (a) => a.id === values.account_from_id,
      );
      const toAcc = activeAccounts.find((a) => a.id === values.account_to_id);
      if (fromAcc && toAcc && fromAcc.currency !== toAcc.currency) {
        toast.error(
          `Moneda incompatible: ${fromAcc.currency} → ${toAcc.currency}.`,
        );
        return;
      }
      createTransferMut.mutate(
        {
          account_from_id: values.account_from_id!,
          account_to_id: values.account_to_id!,
          channel_id: values.channel_id,
          amount: values.amount,
          currency: values.currency,
          transaction_date: values.transaction_date,
          accrual_month: values.accrual_month,
          description: values.description,
        },
        {
          onSuccess: () => {
            toast.success("Transferencia registrada.");
            onSuccess?.();
          },
          onError: (err) => toast.error(err.message),
        },
      );
      return;
    }

    createTxMut.mutate(
      {
        account_id: values.account_id!,
        channel_id: values.channel_id,
        kind: values.kind,
        amount: values.amount,
        currency: values.currency,
        transaction_date: values.transaction_date,
        accrual_month: values.accrual_month,
        description: values.description,
      },
      {
        onSuccess: () => {
          toast.success(
            values.kind === "income"
              ? "Ingreso registrado."
              : "Egreso registrado.",
          );
          onSuccess?.();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* Kind picker */}
        <div className="grid grid-cols-3 gap-2">
          <KindButton
            active={kind === "income"}
            onClick={() => form.setValue("kind", "income")}
            label="Ingreso"
          />
          <KindButton
            active={kind === "expense"}
            onClick={() => form.setValue("kind", "expense")}
            label="Egreso"
          />
          <KindButton
            active={kind === "transfer"}
            onClick={() => form.setValue("kind", "transfer")}
            label="Transferencia"
          />
        </div>

        {/* Account(s) */}
        {kind === "transfer" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="account_from_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Cuenta origen</FormLabel>
                  <Select
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegir cuenta" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent position="popper">
                      {activeAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}{" "}
                          <span className="text-xs text-muted-foreground">
                            · {a.currency}
                          </span>
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
              name="account_to_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Cuenta destino</FormLabel>
                  <Select
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegir cuenta" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent position="popper">
                      {activeAccounts
                        .filter((a) => a.id !== accountFromId)
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}{" "}
                            <span className="text-xs text-muted-foreground">
                              · {a.currency}
                            </span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        ) : (
          <FormField
            control={form.control}
            name="account_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Cuenta</FormLabel>
                <Select
                  value={field.value ?? ""}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Elegir cuenta" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent position="popper">
                    {activeAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}{" "}
                        <span className="text-xs text-muted-foreground">
                          · {a.currency}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Channel + amount + currency */}
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_100px]">
          <FormField
            control={form.control}
            name="channel_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Canal</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent position="popper">
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
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Monto</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
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
              <FormItem>
                <FormLabel className="text-xs">Moneda</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent position="popper">
                    {TRANSACTION_CURRENCIES.map((c) => (
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

        {/* Dates */}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="transaction_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Fecha</FormLabel>
                <FormControl>
                  <DatePicker
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v);
                      form.setValue("accrual_month", defaultAccrualMonth(v));
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="accrual_month"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">
                  Mes devengado{" "}
                  <span className="text-muted-foreground">(día 1)</span>
                </FormLabel>
                <FormControl>
                  <Input
                    type="month"
                    value={field.value.slice(0, 7)}
                    onChange={(e) => field.onChange(`${e.target.value}-01`)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Description */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Descripción</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={2}
                  placeholder={
                    kind === "transfer"
                      ? "Ej. Pase de Caja a Banco Galicia"
                      : kind === "income"
                        ? "Ej. Cobro factura a cliente X"
                        : "Ej. Pago combustible flota"
                  }
                />
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
            {isSaving ? "Guardando…" : "Registrar"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function KindButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-sm transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted/50"
      }`}
    >
      {label}
    </button>
  );
}
