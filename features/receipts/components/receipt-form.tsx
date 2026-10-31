"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
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
import {
  ClientPicker,
  type PickedClient,
} from "@/features/invoices/components/client-picker";
import type { Account } from "@/features/accounts/schema";
import {
  amountToInput,
  round2,
  formatNumber2,
  parseArAmount,
  sumArAmountsBy,
  todayInAR,
} from "@/lib/format";

import { getClientByIdAction } from "@/features/clients/actions/clients-actions";
import type { ReceiptDetail } from "../actions/receipts-actions";
import {
  useCreateReceipt,
  useNextReceiptNumero,
  useUpdateReceipt,
} from "../hooks/use-receipts";
import {
  formatReceiptNumber,
  RECEIPT_CURRENCIES,
  type ReceiptCurrency,
} from "../schema";
import { AllocationsPicker, type AllocationDraft } from "./allocations-picker";
import {
  PaymentLinesEditor,
  type PaymentLineDraft,
} from "./payment-lines-editor";
import { RetentionsEditor, type RetentionDraft } from "./retentions-editor";

export interface ChannelOption {
  id: string;
  name: string;
}

type Mode = "create" | "edit";

const formatMoney = formatNumber2;

function sumDraftLines(lines: PaymentLineDraft[]): number {
  return sumArAmountsBy(lines, (l) => l.amount);
}

function sumDraftRetentions(rets: RetentionDraft[]): number {
  return sumArAmountsBy(rets, (r) => r.amount);
}

const FormSchema = z.object({
  channelId: z.string().min(1, "Canal requerido."),
  numero: z.string().regex(/^\d+$/, "Número inválido."),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  currency: z.enum(RECEIPT_CURRENCIES),
  client: z.custom<PickedClient>().nullable(),
  notes: z.string().trim().max(500),
  paymentLines: z.custom<PaymentLineDraft[]>(),
  allocations: z.custom<AllocationDraft[]>(),
  retentions: z.custom<RetentionDraft[]>(),
});

type FormValues = z.infer<typeof FormSchema>;

export function ReceiptForm({
  mode,
  channels,
  accounts,
  receipt,
  initialClient,
  onSuccess,
  onCancel,
}: {
  mode: Mode;
  channels: ChannelOption[];
  accounts: Account[];
  receipt?: ReceiptDetail;
  initialClient?: PickedClient | null;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const createMut = useCreateReceipt();
  const updateMut = useUpdateReceipt();
  const isSaving = createMut.isPending || updateMut.isPending;

  const defaultChannel = useDefaultChannel();
  const initialChannel = receipt?.receipt.channel_id ?? defaultChannel ?? "";

  const initialPaymentLines: PaymentLineDraft[] = receipt
    ? receipt.payment_lines.map((l) => {
        const check = receipt.checks_by_line[l.id];
        return {
          account_id: l.account_id,
          amount: amountToInput(Number(l.amount)),
          reference: l.reference ?? check?.check_number ?? "",
          check: check
            ? {
                bank_name: check.bank_name,
                drawer_name: check.drawer_name,
                drawer_cuit: check.drawer_cuit ?? "",
                issue_date: check.issue_date,
                due_date: check.due_date,
              }
            : undefined,
        };
      })
    : [{ account_id: "", amount: "", reference: "" }];

  const initialAllocations: AllocationDraft[] = receipt
    ? receipt.allocations.map((a) => ({
        invoice_id: a.invoice_id,
        amount_applied: amountToInput(Number(a.amount_applied)),
      }))
    : [];

  const initialRetentions: RetentionDraft[] = receipt
    ? receipt.retentions.map((r) => ({
        kind: r.kind,
        tax_type: r.tax_type,
        jurisdiction: r.jurisdiction ?? "",
        certificate_number: r.certificate_number,
        certificate_date: r.certificate_date,
        amount: amountToInput(Number(r.amount)),
        notes: r.notes ?? "",
      }))
    : [];

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      channelId: initialChannel,
      numero: receipt ? String(receipt.receipt.numero) : "",
      receiptDate: receipt?.receipt.receipt_date ?? todayInAR(),
      currency:
        (receipt?.receipt.currency as ReceiptCurrency | undefined) ?? "ARS",
      client: initialClient ?? null,
      notes: receipt?.receipt.notes ?? "",
      paymentLines: initialPaymentLines,
      allocations: initialAllocations,
      retentions: initialRetentions,
    },
  });

  const channelId = form.watch("channelId");
  const receiptDate = form.watch("receiptDate");
  const currency = form.watch("currency");
  const client = form.watch("client");
  const paymentLines = form.watch("paymentLines");
  const allocations = form.watch("allocations");
  const retentions = form.watch("retentions");

  const nextNumero = useNextReceiptNumero(mode === "create" ? channelId : null);
  const isFirst = nextNumero.isFirst;

  // Pre-load the picked client when editing.
  useEffect(() => {
    if (!receipt) return;
    void (async () => {
      const res = await getClientByIdAction(receipt.receipt.client_id);
      if (res.ok && res.data) {
        form.setValue("client", {
          id: res.data.id,
          legal_name: res.data.legal_name,
          display_name: res.data.display_name,
          cuit: res.data.cuit,
          iva_condition: res.data.iva_condition,
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt]);

  // Mirror the suggested next number into the local input when the channel
  // changes (or the query resolves). Stays a controlled input so the user
  // can override it when isFirst is true.
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
  const retentionSum = useMemo(
    () => round2(sumDraftRetentions(retentions)),
    [retentions],
  );
  const totalAmount = round2(paymentSum + retentionSum);
  const allocatedAmount = useMemo(
    () => round2(sumArAmountsBy(allocations, (a) => a.amount_applied)),
    [allocations],
  );
  const aCuenta = Math.max(0, totalAmount - allocatedAmount);

  const numeroLocked = mode === "edit" || !isFirst;

  function onSubmit(values: FormValues) {
    if (!values.client) {
      toast.error("Seleccioná un cliente.");
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

    const lines = values.paymentLines.map((l) => ({
      account_id: l.account_id,
      amount: parseArAmount(l.amount) ?? 0,
      reference: l.reference.trim().length === 0 ? null : l.reference.trim(),
      check: l.check
        ? {
            check_number:
              l.reference.trim().length === 0 ? undefined : l.reference.trim(),
            bank_name: l.check.bank_name.trim(),
            drawer_name: l.check.drawer_name.trim(),
            drawer_cuit: l.check.drawer_cuit.trim(),
            issue_date: l.check.issue_date || values.receiptDate,
            due_date: l.check.due_date,
          }
        : undefined,
    }));
    const allocs = values.allocations.map((a) => ({
      invoice_id: a.invoice_id,
      amount_applied: parseArAmount(a.amount_applied) ?? 0,
    }));
    const rets = values.retentions.map((r) => ({
      kind: r.kind,
      tax_type: r.tax_type,
      jurisdiction:
        r.jurisdiction.trim().length === 0 ? null : r.jurisdiction.trim(),
      certificate_number: r.certificate_number.trim(),
      certificate_date: r.certificate_date,
      amount: parseArAmount(r.amount) ?? 0,
      notes: r.notes.trim().length === 0 ? null : r.notes.trim(),
    }));

    if (lines.some((l) => !l.account_id)) {
      toast.error("Cada línea de pago necesita una cuenta.");
      return;
    }
    if (lines.some((l) => l.amount <= 0)) {
      toast.error("Cada línea de pago necesita un monto mayor a cero.");
      return;
    }
    const chequeError = lines.find((l) => l.check && !l.check.due_date);
    if (chequeError) {
      toast.error("Para pagos con check necesitamos la fecha de cobro.");
      return;
    }
    if (rets.some((r) => r.amount <= 0)) {
      toast.error("Cada retención necesita un monto mayor a cero.");
      return;
    }
    if (rets.some((r) => r.certificate_number.length === 0)) {
      toast.error("Cada retención necesita un número de certificado.");
      return;
    }

    if (mode === "create") {
      createMut.mutate(
        {
          channel_id: values.channelId,
          numero: numeroParsed,
          client_id: values.client.id,
          receipt_date: values.receiptDate,
          total_amount: totalAmount,
          currency: values.currency,
          notes: values.notes,
          payment_lines: lines,
          allocations: allocs,
          retentions: rets,
        },
        {
          onSuccess: (data) => {
            toast.success(
              `Recibo ${formatReceiptNumber(data.punto_venta, data.numero)} emitido.`,
            );
            if (onSuccess) onSuccess(data.id);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    } else if (receipt) {
      updateMut.mutate(
        {
          id: receipt.receipt.id,
          receipt_date: values.receiptDate,
          total_amount: totalAmount,
          notes: values.notes,
          payment_lines: lines,
          allocations: allocs,
          retentions: rets,
        },
        {
          onSuccess: () => {
            toast.success("Recibo actualizado.");
            if (onSuccess) onSuccess(receipt.receipt.id);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* Header: channel + numero + date + currency */}
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
            name="receiptDate"
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
                  onValueChange={(v) => field.onChange(v as ReceiptCurrency)}
                  disabled={mode === "edit"}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent position="popper">
                    {RECEIPT_CURRENCIES.map((c) => (
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
            Es el primer recibo de este canal. Si ya tenías una numeración
            previa en otro sistema, podés escribir el siguiente número
            manualmente. Después queda fijado.
          </div>
        )}

        {/* Client */}
        <FormField
          control={form.control}
          name="client"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-xs">Cliente</FormLabel>
              <FormControl>
                <ClientPicker value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Payment lines */}
        <PaymentLinesEditor
          accounts={accounts.filter((a) => a.is_active)}
          lines={paymentLines}
          onChange={(lines) => form.setValue("paymentLines", lines)}
          defaultDate={receiptDate}
        />

        {/* Retentions / Percepciones */}
        <RetentionsEditor
          retentions={retentions}
          onChange={(rets) => form.setValue("retentions", rets)}
          defaultDate={receiptDate}
        />

        {/* Allocations */}
        <AllocationsPicker
          clientId={client?.id ?? null}
          channelId={channelId || null}
          excludeReceiptId={receipt?.receipt.id}
          allocations={allocations}
          onChange={(allocs) => form.setValue("allocations", allocs)}
        />

        {/* Totals strip */}
        <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-5">
          <div>
            <div className="text-xs text-muted-foreground">Pago real</div>
            <div className="font-mono">
              {formatMoney(paymentSum)} {currency}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Retenciones</div>
            <div className="font-mono">
              {formatMoney(retentionSum)} {currency}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total</div>
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

        {/* Notes */}
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
                ? "Emitir recibo"
                : "Guardar cambios"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
