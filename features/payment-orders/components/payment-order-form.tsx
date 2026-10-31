"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
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
import type { Account, AccountNameJoin } from "@/features/accounts/schema";
import { listEnCarteraChecksAction } from "@/features/checks/actions/checks-actions";
import { getSupplierByIdAction } from "@/features/suppliers/actions/suppliers-actions";
import { checksKeys } from "@/features/checks/lib/checks-keys";
import {
  SupplierPicker,
  type PickedSupplier,
} from "@/features/suppliers/components/supplier-picker";
import {
  amountToInput,
  round2,
  formatNumber2 as formatMoney,
  parseArAmount,
  sumArAmountsBy,
  todayInAR,
} from "@/lib/format";
import { runAction } from "@/lib/query/run-action";
import { DEFAULT_CHANNEL_ID } from "@/lib/scope";

import type { PaymentOrderDetail } from "../actions/payment-orders-actions";
import {
  useCreatePaymentOrder,
  useNextPaymentOrderNumero,
  useUpdatePaymentOrder,
} from "../hooks/use-payment-orders";
import {
  PAYMENT_ORDER_CURRENCIES,
  formatPaymentOrderNumber,
  type EndorsedCheckJoin,
  type IssuedCheckJoin,
  type PaymentOrderCurrency,
} from "../schema";
import { AllocationsPicker, type AllocationDraft } from "./allocations-picker";
import {
  PaymentLinesEditor,
  type PaymentLineDraft,
} from "./payment-lines-editor";

export interface ChannelOption {
  id: string;
  name: string;
}

type Mode = "create" | "edit";

function lineAmount(l: PaymentLineDraft): number {
  if (l.line_kind === "endorse_check") return l.amount;
  return parseArAmount(l.amount) ?? 0;
}

function sumDraftLines(lines: PaymentLineDraft[]): number {
  return lines.reduce((acc, l) => acc + lineAmount(l), 0);
}

const FormSchema = z.object({
  channelId: z.string().min(1, "Canal requerido."),
  numero: z.string().regex(/^\d+$/, "Número inválido."),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  currency: z.enum(PAYMENT_ORDER_CURRENCIES),
  supplier: z.custom<PickedSupplier>().nullable(),
  notes: z.string().trim().max(500),
  paymentLines: z.custom<PaymentLineDraft[]>(),
  allocations: z.custom<AllocationDraft[]>(),
});

type FormValues = z.infer<typeof FormSchema>;

export function PaymentOrderForm({
  mode,
  channels,
  accounts,
  paymentOrder,
  initialSupplier,
  onSuccess,
  onCancel,
}: {
  mode: Mode;
  channels: ChannelOption[];
  accounts: Account[];
  paymentOrder?: PaymentOrderDetail;
  initialSupplier?: PickedSupplier | null;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const createMut = useCreatePaymentOrder();
  const updateMut = useUpdatePaymentOrder();
  const isSaving = createMut.isPending || updateMut.isPending;

  const initialChannel =
    paymentOrder?.paymentOrder.channel_id ??
    channels.find((c) => c.id === DEFAULT_CHANNEL_ID)?.id ??
    channels[0]?.id ??
    "";

  const initialPaymentLines: PaymentLineDraft[] = paymentOrder
    ? paymentOrder.payment_lines.map((l): PaymentLineDraft => {
        const accountJoin = (l as unknown as AccountNameJoin).account;
        const endorsed = (l as unknown as EndorsedCheckJoin).endorsed_check;
        if (endorsed) {
          const label =
            `${endorsed.kind === "echeq" ? "ECHEQ" : "Cheque"} ${endorsed.bank_name} #${endorsed.check_number}` +
            (endorsed.drawer_name ? ` · ${endorsed.drawer_name}` : "");
          return {
            line_kind: "endorse_check",
            endorsed_check_id: endorsed.id,
            check_label: label,
            amount: Number(l.amount),
            cartera_account_id: l.account_id,
            cartera_account_name: accountJoin?.name ?? "—",
            reference: l.reference ?? "",
          };
        }
        const issued = (l as unknown as IssuedCheckJoin).issued_check;
        if (issued) {
          return {
            line_kind: "issue_check",
            account_id: l.account_id,
            amount: amountToInput(Number(l.amount)),
            reference: l.reference ?? "",
            check_kind: issued.kind,
            check_number: issued.check_number,
            bank_name: issued.bank_name,
            due_date: issued.due_date,
            beneficiary_name: "",
            beneficiary_cuit: "",
          };
        }
        return {
          line_kind: "account",
          account_id: l.account_id,
          amount: amountToInput(Number(l.amount)),
          reference: l.reference ?? "",
        };
      })
    : [
        {
          line_kind: "account",
          account_id: "",
          amount: "",
          reference: "",
        },
      ];

  const initialAllocations: AllocationDraft[] = paymentOrder
    ? paymentOrder.allocations.map((a) => ({
        purchase_invoice_id: a.purchase_invoice_id,
        amount_applied: amountToInput(Number(a.amount_applied)),
      }))
    : [];

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      channelId: initialChannel,
      numero: paymentOrder ? String(paymentOrder.paymentOrder.numero) : "",
      paymentDate: paymentOrder?.paymentOrder.payment_date ?? todayInAR(),
      currency:
        (paymentOrder?.paymentOrder.currency as
          PaymentOrderCurrency | undefined) ?? "ARS",
      supplier: initialSupplier ?? null,
      notes: paymentOrder?.paymentOrder.notes ?? "",
      paymentLines: initialPaymentLines,
      allocations: initialAllocations,
    },
  });

  const channelId = form.watch("channelId");
  const currency = form.watch("currency");
  const supplier = form.watch("supplier");
  const paymentLines = form.watch("paymentLines");
  const allocations = form.watch("allocations");

  const nextNumero = useNextPaymentOrderNumero(
    mode === "create" ? channelId : null,
  );
  const isFirst = nextNumero.isFirst;

  // In edit mode we also fetch the on-hand checks in case the user wants to
  // endorse a new one on top of the ones the OP already had.
  const carteraChecksQuery = useQuery({
    queryKey: checksKeys.enCartera(currency),
    queryFn: () => runAction(() => listEnCarteraChecksAction({ currency })),
    staleTime: 30_000,
  });

  // Pre-load the picked supplier when editing.
  useEffect(() => {
    if (!paymentOrder) return;
    void (async () => {
      const res = await getSupplierByIdAction(
        paymentOrder.paymentOrder.supplier_id,
      );
      if (res.ok && res.data) {
        form.setValue("supplier", {
          id: res.data.id,
          legal_name: res.data.legal_name,
          display_name: res.data.display_name,
          cuit: res.data.cuit,
          iva_condition: res.data.iva_condition,
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentOrder]);

  useEffect(() => {
    if (mode !== "create") return;
    if (nextNumero.next == null) return;
    form.setValue("numero", String(nextNumero.next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, nextNumero.next]);

  const paymentSum = useMemo(
    () => round2(sumDraftLines(paymentLines)),
    [paymentLines],
  );
  const totalAmount = paymentSum;
  const allocatedAmount = useMemo(
    () => round2(sumArAmountsBy(allocations, (a) => a.amount_applied)),
    [allocations],
  );
  const aCuenta = Math.max(0, totalAmount - allocatedAmount);

  const numeroLocked = mode === "edit" || !isFirst;

  function onSubmit(values: FormValues) {
    if (!values.supplier) {
      toast.error("Seleccioná un proveedor.");
      return;
    }
    if (values.paymentLines.length === 0) {
      toast.error("Agregá al menos una línea de pago.");
      return;
    }

    const numeroParsed = Number.parseInt(values.numero, 10);
    if (!Number.isFinite(numeroParsed) || numeroParsed < 1) {
      toast.error("Número inválido.");
      return;
    }

    const lines = values.paymentLines.map((l) => {
      const ref = l.reference.trim().length === 0 ? null : l.reference.trim();
      if (l.line_kind === "endorse_check") {
        return {
          line_kind: "endorse_check" as const,
          endorsed_check_id: l.endorsed_check_id,
          amount: l.amount,
          reference: ref,
        };
      }
      if (l.line_kind === "issue_check") {
        return {
          line_kind: "issue_check" as const,
          account_id: l.account_id,
          amount: parseArAmount(l.amount) ?? 0,
          reference: ref,
          issued_check: {
            kind: l.check_kind,
            check_number: l.check_number.trim(),
            bank_name: l.bank_name.trim(),
            due_date: l.due_date,
            issue_date: values.paymentDate,
            beneficiary_name:
              l.beneficiary_name.trim().length === 0
                ? null
                : l.beneficiary_name.trim(),
            beneficiary_cuit:
              l.beneficiary_cuit.trim().length === 0
                ? null
                : l.beneficiary_cuit.trim(),
            notes: null,
          },
        };
      }
      return {
        line_kind: "account" as const,
        account_id: l.account_id,
        amount: parseArAmount(l.amount) ?? 0,
        reference: ref,
      };
    });
    const allocs = values.allocations.map((a) => ({
      purchase_invoice_id: a.purchase_invoice_id,
      amount_applied: parseArAmount(a.amount_applied) ?? 0,
    }));

    for (const l of lines) {
      if (l.line_kind === "account" && !l.account_id) {
        toast.error("Cada línea de cuenta necesita una cuenta seleccionada.");
        return;
      }
      if (l.line_kind === "issue_check") {
        if (!l.account_id) {
          toast.error("La chequera (cuenta bancaria) es requerida.");
          return;
        }
        if (!l.issued_check.check_number) {
          toast.error("Nº de cheque requerido.");
          return;
        }
        if (!l.issued_check.bank_name) {
          toast.error("Banco del cheque requerido.");
          return;
        }
        if (!l.issued_check.due_date) {
          toast.error("Fecha de vto. del cheque requerida.");
          return;
        }
      }
      if (l.amount <= 0) {
        toast.error("Cada línea necesita un monto mayor a cero.");
        return;
      }
    }

    if (mode === "create") {
      createMut.mutate(
        {
          channel_id: values.channelId,
          numero: numeroParsed,
          supplier_id: values.supplier.id,
          payment_date: values.paymentDate,
          total_amount: totalAmount,
          currency: values.currency,
          notes: values.notes,
          payment_lines: lines,
          allocations: allocs,
        },
        {
          onSuccess: (data) => {
            toast.success(
              `OP ${formatPaymentOrderNumber(data.punto_venta, data.numero)} emitida.`,
            );
            if (onSuccess) onSuccess(data.id);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    } else if (paymentOrder) {
      updateMut.mutate(
        {
          id: paymentOrder.paymentOrder.id,
          payment_date: values.paymentDate,
          total_amount: totalAmount,
          notes: values.notes,
          payment_lines: lines,
          allocations: allocs,
        },
        {
          onSuccess: () => {
            toast.success("Orden de pago actualizada.");
            if (onSuccess) onSuccess(paymentOrder.paymentOrder.id);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_140px_100px]">
          <FormField
            control={form.control}
            name="channelId"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">Canal</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(next) => {
                    field.onChange(next);
                    // Allocations are per channel — drop picks from the old one.
                    form.setValue("allocations", []);
                  }}
                  disabled={mode === "edit"}
                >
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
            name="numero"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">Número</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={numeroLocked}
                    type="number"
                    min={1}
                    inputMode="numeric"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="paymentDate"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs">Fecha</FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} />
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
                    field.onChange(v as PaymentOrderCurrency)
                  }
                  disabled={mode === "edit"}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent position="popper">
                    {PAYMENT_ORDER_CURRENCIES.map((c) => (
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

        {mode === "create" && isFirst && (
          <div className="rounded-md border border-border bg-muted p-2 text-xs text-muted-foreground dark:text-muted-foreground">
            Es la primera OP de este canal. Si ya tenías una numeración previa
            en otro sistema, podés escribir el siguiente número manualmente.
            Después queda fijado.
          </div>
        )}

        <FormField
          control={form.control}
          name="supplier"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-xs">Proveedor</FormLabel>
              <FormControl>
                <SupplierPicker value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <PaymentLinesEditor
          accounts={accounts.filter((a) => a.is_active)}
          // A check is endorsed only in a payment order of its own channel;
          // one without channel takes the payment order's.
          carteraChecks={(carteraChecksQuery.data ?? []).filter(
            (c) => c.channel_id === null || c.channel_id === channelId,
          )}
          carteraChecksLoading={carteraChecksQuery.isLoading}
          currency={currency}
          lines={paymentLines}
          onChange={(lines) => form.setValue("paymentLines", lines)}
        />

        <AllocationsPicker
          supplierId={supplier?.id ?? null}
          channelId={channelId || null}
          excludePaymentOrderId={paymentOrder?.paymentOrder.id}
          allocations={allocations}
          onChange={(allocs) => form.setValue("allocations", allocs)}
        />

        <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">Total a pagar</div>
            <div className="font-mono font-semibold">
              {formatMoney(totalAmount)} {currency}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Imputado</div>
            <div className="font-mono">
              {formatMoney(allocatedAmount)} {currency}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">A cuenta</div>
            <div className="font-mono">
              {formatMoney(aCuenta)} {currency}
            </div>
          </div>
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
                ? "Emitir orden de pago"
                : "Guardar cambios"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
