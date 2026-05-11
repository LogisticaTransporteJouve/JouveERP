"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import {
  ClientPicker,
  type PickedClient,
} from "@/features/invoices/components/client-picker";
import type { Account } from "@/features/accounts/schema";

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
import {
  AllocationsPicker,
  type AllocationDraft,
} from "./allocations-picker";
import {
  PaymentLinesEditor,
  type PaymentLineDraft,
} from "./payment-lines-editor";
import {
  RetentionsEditor,
  type RetentionDraft,
} from "./retentions-editor";

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

function sumDraftLines(lines: PaymentLineDraft[]): number {
  return lines.reduce((acc, l) => acc + (parseAmount(l.amount) ?? 0), 0);
}

function sumDraftAllocations(allocs: AllocationDraft[]): number {
  return allocs.reduce(
    (acc, a) => acc + (parseAmount(a.amount_applied) ?? 0),
    0,
  );
}

function sumDraftRetentions(rets: RetentionDraft[]): number {
  return rets.reduce((acc, r) => acc + (parseAmount(r.amount) ?? 0), 0);
}

export function ReceiptForm({
  mode,
  channels,
  accounts,
  receipt,
  onSuccess,
  onCancel,
}: {
  mode: Mode;
  channels: ChannelOption[];
  accounts: Account[];
  receipt?: ReceiptDetail;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const createMut = useCreateReceipt();
  const updateMut = useUpdateReceipt();
  const isSaving = createMut.isPending || updateMut.isPending;

  const initialChannel =
    receipt?.receipt.channel_id ??
    channels.find((c) => c.id === DEFAULT_CHANNEL_ID)?.id ??
    channels[0]?.id ??
    "";

  const [channelId, setChannelId] = useState(initialChannel);
  const [numero, setNumero] = useState<string>(
    receipt ? String(receipt.receipt.numero) : "",
  );
  const nextNumero = useNextReceiptNumero(
    mode === "create" ? channelId : null,
  );
  const isFirst = nextNumero.isFirst;

  const [reciboDate, setReciboDate] = useState<string>(
    receipt?.receipt.receipt_date ?? todayISO(),
  );
  const [currency, setCurrency] = useState<ReceiptCurrency>(
    (receipt?.receipt.currency as ReceiptCurrency | undefined) ?? "ARS",
  );
  const [client, setClient] = useState<PickedClient | null>(null);
  const [notes, setNotes] = useState<string>(receipt?.receipt.notes ?? "");

  const [paymentLines, setPaymentLines] = useState<PaymentLineDraft[]>(
    receipt
      ? receipt.payment_lines.map((l) => {
          const check = receipt.checks_by_line[l.id];
          return {
            account_id: l.account_id,
            amount: String(l.amount),
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
      : [{ account_id: "", amount: "", reference: "" }],
  );

  const [allocations, setAllocations] = useState<AllocationDraft[]>(
    receipt
      ? receipt.allocations.map((a) => ({
          invoice_id: a.invoice_id,
          amount_applied: String(a.amount_applied),
        }))
      : [],
  );

  const [retentions, setRetentions] = useState<RetentionDraft[]>(
    receipt
      ? receipt.retentions.map((r) => ({
          kind: r.kind,
          tax_type: r.tax_type,
          jurisdiction: r.jurisdiction ?? "",
          certificate_number: r.certificate_number,
          certificate_date: r.certificate_date,
          amount: String(r.amount),
          notes: r.notes ?? "",
        }))
      : [],
  );

  // Pre-load the picked client when editing.
  useEffect(() => {
    if (!receipt) return;
    void (async () => {
      const mod = await import("@/features/clients/actions/clients-actions");
      const res = await mod.getClientByIdAction(receipt.receipt.client_id);
      if (res.ok && res.data) {
        setClient({
          id: res.data.id,
          legal_name: res.data.legal_name,
          display_name: res.data.display_name,
          cuit: res.data.cuit,
          iva_condition: res.data.iva_condition,
        });
      }
    })();
  }, [receipt]);

  // Mirror the suggested next number into the local input when the channel
  // changes (or the query resolves). Stays a controlled input so the user
  // can override it when isFirst is true.
  useEffect(() => {
    if (mode !== "create") return;
    if (nextNumero.next == null) return;
    setNumero(String(nextNumero.next));
  }, [mode, nextNumero.next]);

  const paymentSum = useMemo(
    () => Math.round(sumDraftLines(paymentLines) * 100) / 100,
    [paymentLines],
  );
  const retentionSum = useMemo(
    () => Math.round(sumDraftRetentions(retentions) * 100) / 100,
    [retentions],
  );
  // Total = real money + retention certificates. Both cancel allocations.
  const totalAmount = Math.round((paymentSum + retentionSum) * 100) / 100;
  const allocatedAmount = useMemo(
    () => Math.round(sumDraftAllocations(allocations) * 100) / 100,
    [allocations],
  );
  const aCuenta = Math.max(0, totalAmount - allocatedAmount);

  const numeroLocked = mode === "edit" || !isFirst;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!client) {
      toast.error("Seleccioná un cliente.");
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

    const lines: Array<{
      account_id: string;
      amount: number;
      reference: string | null;
      check?: {
        check_number: string | undefined;
        bank_name: string;
        drawer_name: string;
        drawer_cuit: string;
        issue_date: string;
        due_date: string;
      };
    }> = paymentLines.map((l) => ({
      account_id: l.account_id,
      amount: parseAmount(l.amount) ?? 0,
      reference: l.reference.trim().length === 0 ? null : l.reference.trim(),
      check: l.check
        ? {
            check_number:
              l.reference.trim().length === 0 ? undefined : l.reference.trim(),
            bank_name: l.check.bank_name.trim(),
            drawer_name: l.check.drawer_name.trim(),
            drawer_cuit: l.check.drawer_cuit.trim(),
            issue_date: l.check.issue_date || reciboDate,
            due_date: l.check.due_date,
          }
        : undefined,
    }));
    const allocs = allocations.map((a) => ({
      invoice_id: a.invoice_id,
      amount_applied: parseAmount(a.amount_applied) ?? 0,
    }));
    const rets = retentions.map((r) => ({
      kind: r.kind,
      tax_type: r.tax_type,
      jurisdiction:
        r.jurisdiction.trim().length === 0 ? null : r.jurisdiction.trim(),
      certificate_number: r.certificate_number.trim(),
      certificate_date: r.certificate_date,
      amount: parseAmount(r.amount) ?? 0,
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
    // Cheque-specific validation: when a line carries check metadata the
    // bank, drawer and due_date are mandatory (the schema in cheques table
    // would reject otherwise — surface a clearer error here).
    const chequeError = lines.find(
      (l) =>
        l.check &&
        (!l.check.bank_name ||
          !l.check.drawer_name ||
          !l.check.due_date),
    );
    if (chequeError) {
      toast.error(
        "Para pagos con check necesitamos banco, firmante y fecha de cobro.",
      );
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
          channel_id: channelId,
          numero: numeroParsed,
          client_id: client.id,
          receipt_date: reciboDate,
          total_amount: totalAmount,
          currency,
          notes,
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
          receipt_date: reciboDate,
          total_amount: totalAmount,
          notes,
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
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Header: channel + numero + date + currency */}
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
          <Input
            type="date"
            value={reciboDate}
            onChange={(e) => setReciboDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Moneda</Label>
          <Select
            value={currency}
            onValueChange={(v) => setCurrency(v as ReceiptCurrency)}
            disabled={mode === "edit"}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {RECEIPT_CURRENCIES.map((c) => (
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
          Es el primer recibo de este canal. Si ya tenías una numeración previa
          en otro sistema, podés escribir el siguiente número manualmente.
          Después queda fijado.
        </div>
      )}

      {/* Client */}
      <div className="space-y-1">
        <Label className="text-xs">Cliente</Label>
        <ClientPicker value={client} onChange={setClient} />
      </div>

      {/* Payment lines */}
      <PaymentLinesEditor
        accounts={accounts.filter((a) => a.is_active)}
        lines={paymentLines}
        onChange={setPaymentLines}
        defaultDate={reciboDate}
      />

      {/* Retentions / Percepciones */}
      <RetentionsEditor
        retentions={retentions}
        onChange={setRetentions}
        defaultDate={reciboDate}
      />

      {/* Allocations */}
      <AllocationsPicker
        clientId={client?.id ?? null}
        excludeReceiptId={receipt?.receipt.id}
        allocations={allocations}
        onChange={setAllocations}
      />

      {/* Totals strip */}
      <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-5">
        <div>
          <div className="text-xs text-muted-foreground">Pago real</div>
          <div className="font-mono">
            {paymentSum.toFixed(2)} {currency}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Retenciones</div>
          <div className="font-mono">
            {retentionSum.toFixed(2)} {currency}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="font-mono font-semibold">
            {totalAmount.toFixed(2)} {currency}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Imputado</div>
          <div className="font-mono">
            {allocatedAmount.toFixed(2)} {currency}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">A cuenta</div>
          <div className="font-mono">
            {aCuenta.toFixed(2)} {currency}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1">
        <Label className="text-xs">Notas</Label>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
              ? "Emitir recibo"
              : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
