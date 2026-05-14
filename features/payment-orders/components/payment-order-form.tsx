"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import type { Account } from "@/features/accounts/schema";
import { listEnCarteraChecksAction } from "@/features/checks/actions/checks-actions";
import {
  SupplierPicker,
  type PickedSupplier,
} from "@/features/suppliers/components/supplier-picker";
import { amountToInput } from "@/lib/format";
import { runAction } from "@/lib/query/run-action";

import type { PaymentOrderDetail } from "../actions/payment-orders-actions";
import {
  useCreatePaymentOrder,
  useNextPaymentOrderNumero,
  useUpdatePaymentOrder,
} from "../hooks/use-payment-orders";
import {
  PAYMENT_ORDER_CURRENCIES,
  formatPaymentOrderNumber,
  type PaymentOrderCurrency,
} from "../schema";
import {
  AllocationsPicker,
  type AllocationDraft,
} from "./allocations-picker";
import {
  PaymentLinesEditor,
  type AccountLineDraft,
  type PaymentLineDraft,
} from "./payment-lines-editor";

const DEFAULT_CHANNEL_ID = "jouve_fiscal";

export interface ChannelOption {
  id: string;
  name: string;
}

type Mode = "create" | "edit";

function todayISO() {
  const d = new Date();
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return ar.toISOString().slice(0, 10);
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/\./g, "").replace(",", ".");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

const moneyFormatter = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function formatMoney(value: number): string {
  return moneyFormatter.format(value);
}

function lineAmount(l: PaymentLineDraft): number {
  if (l.line_kind === "endorse_check") return l.amount;
  return parseAmount(l.amount) ?? 0;
}

function sumDraftLines(lines: PaymentLineDraft[]): number {
  return lines.reduce((acc, l) => acc + lineAmount(l), 0);
}

function sumDraftAllocations(allocs: AllocationDraft[]): number {
  return allocs.reduce(
    (acc, a) => acc + (parseAmount(a.amount_applied) ?? 0),
    0,
  );
}

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

  const [channelId, setChannelId] = useState(initialChannel);
  const [numero, setNumero] = useState<string>(
    paymentOrder ? String(paymentOrder.paymentOrder.numero) : "",
  );
  const nextNumero = useNextPaymentOrderNumero(
    mode === "create" ? channelId : null,
  );
  const isFirst = nextNumero.isFirst;

  const [paymentDate, setPaymentDate] = useState<string>(
    paymentOrder?.paymentOrder.payment_date ?? todayISO(),
  );
  const [currency, setCurrency] = useState<PaymentOrderCurrency>(
    (paymentOrder?.paymentOrder.currency as PaymentOrderCurrency | undefined) ??
      "ARS",
  );
  const [supplier, setSupplier] = useState<PickedSupplier | null>(
    initialSupplier ?? null,
  );
  const [notes, setNotes] = useState<string>(
    paymentOrder?.paymentOrder.notes ?? "",
  );

  const [paymentLines, setPaymentLines] = useState<PaymentLineDraft[]>(
    paymentOrder
      ? paymentOrder.payment_lines.map(
          (l): AccountLineDraft => ({
            line_kind: "account",
            account_id: l.account_id,
            amount: amountToInput(Number(l.amount)),
            reference: l.reference ?? "",
          }),
        )
      : [
          {
            line_kind: "account",
            account_id: "",
            amount: "",
            reference: "",
          },
        ],
  );

  const carteraChecksQuery = useQuery({
    queryKey: ["checks", "en_cartera", currency],
    queryFn: () =>
      runAction(() => listEnCarteraChecksAction({ currency })),
    enabled: mode === "create",
    staleTime: 30_000,
  });

  const [allocations, setAllocations] = useState<AllocationDraft[]>(
    paymentOrder
      ? paymentOrder.allocations.map((a) => ({
          purchase_invoice_id: a.purchase_invoice_id,
          amount_applied: amountToInput(Number(a.amount_applied)),
        }))
      : [],
  );

  // Pre-load the picked supplier when editing.
  useEffect(() => {
    if (!paymentOrder) return;
    void (async () => {
      const mod = await import(
        "@/features/suppliers/actions/suppliers-actions"
      );
      const res = await mod.getSupplierByIdAction(
        paymentOrder.paymentOrder.supplier_id,
      );
      if (res.ok && res.data) {
        setSupplier({
          id: res.data.id,
          legal_name: res.data.legal_name,
          display_name: res.data.display_name,
          cuit: res.data.cuit,
          iva_condition: res.data.iva_condition,
        });
      }
    })();
  }, [paymentOrder]);

  useEffect(() => {
    if (mode !== "create") return;
    if (nextNumero.next == null) return;
    setNumero(String(nextNumero.next));
  }, [mode, nextNumero.next]);

  const paymentSum = useMemo(
    () => Math.round(sumDraftLines(paymentLines) * 100) / 100,
    [paymentLines],
  );
  const totalAmount = paymentSum;
  const allocatedAmount = useMemo(
    () => Math.round(sumDraftAllocations(allocations) * 100) / 100,
    [allocations],
  );
  const aCuenta = Math.max(0, totalAmount - allocatedAmount);

  const numeroLocked = mode === "edit" || !isFirst;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplier) {
      toast.error("Seleccioná un proveedor.");
      return;
    }
    if (paymentLines.length === 0) {
      toast.error("Agregá al menos una línea de pago.");
      return;
    }

    const numeroParsed = Number.parseInt(numero, 10);
    if (!Number.isFinite(numeroParsed) || numeroParsed < 1) {
      toast.error("Número inválido.");
      return;
    }

    const lines = paymentLines.map((l) => {
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
          amount: parseAmount(l.amount) ?? 0,
          reference: ref,
          issued_check: {
            kind: l.check_kind,
            check_number: l.check_number.trim(),
            bank_name: l.bank_name.trim(),
            due_date: l.due_date,
            issue_date: paymentDate,
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
        amount: parseAmount(l.amount) ?? 0,
        reference: ref,
      };
    });
    const allocs = allocations.map((a) => ({
      purchase_invoice_id: a.purchase_invoice_id,
      amount_applied: parseAmount(a.amount_applied) ?? 0,
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
          channel_id: channelId,
          numero: numeroParsed,
          supplier_id: supplier.id,
          payment_date: paymentDate,
          total_amount: totalAmount,
          currency,
          notes,
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
          payment_date: paymentDate,
          total_amount: totalAmount,
          notes,
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
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_140px_140px_100px]">
        <div className="space-y-1">
          <Label className="text-xs">Canal</Label>
          <Select
            value={channelId}
            onValueChange={setChannelId}
            disabled={mode === "edit"}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Número</Label>
          <Input
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            disabled={numeroLocked}
            type="number"
            min={1}
            inputMode="numeric"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Fecha</Label>
          <DatePicker value={paymentDate} onChange={setPaymentDate} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Moneda</Label>
          <Select
            value={currency}
            onValueChange={(v) => setCurrency(v as PaymentOrderCurrency)}
            disabled={mode === "edit"}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {PAYMENT_ORDER_CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {mode === "create" && isFirst && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          Es la primera OP de este canal. Si ya tenías una numeración previa en
          otro sistema, podés escribir el siguiente número manualmente. Después
          queda fijado.
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Proveedor</Label>
        <SupplierPicker value={supplier} onChange={setSupplier} />
      </div>

      <PaymentLinesEditor
        accounts={accounts.filter((a) => a.is_active)}
        carteraChecks={carteraChecksQuery.data ?? []}
        carteraChecksLoading={carteraChecksQuery.isLoading}
        currency={currency}
        lines={paymentLines}
        onChange={setPaymentLines}
        disableNonAccount={mode === "edit"}
      />

      <AllocationsPicker
        supplierId={supplier?.id ?? null}
        excludePaymentOrderId={paymentOrder?.paymentOrder.id}
        allocations={allocations}
        onChange={setAllocations}
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

      <div className="space-y-1">
        <Label className="text-xs">Notas</Label>
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

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
  );
}
