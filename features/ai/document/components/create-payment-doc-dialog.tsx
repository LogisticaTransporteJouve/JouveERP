"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useScope } from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";

import {
  useCreatePaymentOrderFromExtraction,
  useCreateReceiptFromExtraction,
  useNextDocNumero,
} from "../hooks/use-documents";
import { ReceiptExtractionSchema } from "../schemas";

type DocKind = "receipt" | "payment_order";

const COPY: Record<
  DocKind,
  {
    title: string;
    description: string;
    dateLabel: string;
    accountLabel: string;
    submit: string;
    success: string;
  }
> = {
  receipt: {
    title: "Crear recibo",
    description:
      "Revisá los datos extraídos y elegí la cuenta donde entró la plata. La imputación a facturas es automática (FIFO).",
    dateLabel: "Fecha de cobro",
    accountLabel: "Cuenta de cobro",
    submit: "Crear recibo",
    success: "Recibo creado.",
  },
  payment_order: {
    title: "Crear orden de pago",
    description:
      "Revisá los datos extraídos y elegí la cuenta desde la que se pagó. La imputación a facturas es automática (FIFO).",
    dateLabel: "Fecha de pago",
    accountLabel: "Cuenta de pago",
    submit: "Crear orden de pago",
    success: "Orden de pago creada.",
  },
};

/**
 * Create a recibo or orden de pago from its extraction. Both extractions share
 * the same shape (counterparty, number, date, currency, total), so one dialog
 * covers the two kinds; the target action differs.
 */
export function CreatePaymentDocDialog({
  kind,
  extractionId,
  payload,
  counterpartyName,
  open,
  onOpenChange,
  onCreated,
}: {
  kind: DocKind;
  extractionId: string;
  payload: unknown;
  counterpartyName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const copy = COPY[kind];
  const { channels } = useScope();
  const activeChannels = channels.filter((c) => c.is_active);
  const { data: accounts } = useAccountsList();

  const [channelId, setChannelId] = useState("");
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState("");
  const [importe, setImporte] = useState("");
  const [moneda, setMoneda] = useState<"ARS" | "USD">("ARS");
  const [accountId, setAccountId] = useState("");

  const accountOptions = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.is_active &&
          a.type !== "checks" &&
          a.type !== "echeq" &&
          a.currency === moneda,
      ),
    [accounts, moneda],
  );

  const receiptMut = useCreateReceiptFromExtraction();
  const paymentOrderMut = useCreatePaymentOrderFromExtraction();
  const mutation = kind === "receipt" ? receiptMut : paymentOrderMut;

  useEffect(() => {
    if (!open) return;
    const parsed = ReceiptExtractionSchema.safeParse(payload);
    setChannelId(activeChannels[0]?.id ?? "");
    setNumero(parsed.success && parsed.data.number ? String(parsed.data.number) : "");
    setFecha(parsed.success ? (parsed.data.date ?? "") : "");
    setImporte(
      parsed.success && parsed.data.total_amount != null
        ? String(parsed.data.total_amount)
        : "",
    );
    setMoneda(parsed.success && parsed.data.currency === "USD" ? "USD" : "ARS");
    setAccountId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payload]);

  // Scans of our own documents usually print the numero; when they don't,
  // prefill the channel's next one.
  const nextNumero = useNextDocNumero(kind, channelId, open && numero === "");
  useEffect(() => {
    if (open && numero === "" && nextNumero.data?.next) {
      setNumero(String(nextNumero.data.next));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nextNumero.data]);

  useEffect(() => {
    if (open && !accountId && accountOptions.length === 1) {
      setAccountId(accountOptions[0]!.id);
    }
  }, [open, accountOptions, accountId]);

  function onSubmit() {
    const base = {
      extractionId,
      channelId,
      numero: Number(numero),
      total_amount: Number(importe),
      currency: moneda,
      account_id: accountId,
    };
    mutation.mutate(
      kind === "receipt"
        ? { ...base, receipt_date: fecha }
        : { ...base, payment_date: fecha },
      {
        onSuccess: () => {
          toast.success(copy.success);
          onCreated();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  const incomplete =
    !channelId || !numero || !fecha || !importe || !accountId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {counterpartyName && (
            <p className="text-sm">
              <span className="text-muted-foreground">Contraparte: </span>
              <span className="font-medium">{counterpartyName}</span>
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pd-canal">Canal</Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger id="pd-canal">
                  <SelectValue placeholder="Canal" />
                </SelectTrigger>
                <SelectContent>
                  {activeChannels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pd-numero">Número</Label>
              <Input
                id="pd-numero"
                type="number"
                inputMode="numeric"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pd-fecha">{copy.dateLabel}</Label>
              <Input
                id="pd-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pd-importe">Importe</Label>
              <Input
                id="pd-importe"
                type="number"
                inputMode="decimal"
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pd-moneda">Moneda</Label>
              <Select
                value={moneda}
                onValueChange={(v) => setMoneda(v === "USD" ? "USD" : "ARS")}
              >
                <SelectTrigger id="pd-moneda">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARS">ARS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pd-cuenta">{copy.accountLabel}</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="pd-cuenta">
                  <SelectValue placeholder="Elegí la cuenta" />
                </SelectTrigger>
                <SelectContent>
                  {accountOptions.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={incomplete || mutation.isPending}
          >
            {copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
