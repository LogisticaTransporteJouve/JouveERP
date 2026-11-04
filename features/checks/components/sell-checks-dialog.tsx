"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import { Textarea } from "@/components/ui/textarea";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";
import { formatMoney, parseArAmount, round2, todayInAR } from "@/lib/format";

import { useSellCheques } from "../hooks/use-checks";
import type { Cheque } from "../schema";

import type { CheckChannelOption } from "./check-action-dialogs";

function amountOf(value: string): number {
  if (value.trim() === "") return 0;
  const n = parseArAmount(value);
  return n !== null && n >= 0 ? n : NaN;
}

/**
 * Venta de cheques (descuento) to a bank or financiera: the selected cartera
 * checks leave as vendido, the net lands in the chosen account and the
 * interest and commission are recorded as financial expense.
 */
export function SellChequesDialog({
  checks,
  channels,
  open,
  onOpenChange,
  onSold,
}: {
  checks: Cheque[];
  channels: CheckChannelOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSold: () => void;
}) {
  const { data: accounts } = useAccountsList();
  const mut = useSellCheques();

  const currencies = [...new Set(checks.map((c) => c.currency))];
  const currency = currencies.length === 1 ? currencies[0]! : null;
  const ownChannels = [
    ...new Set(checks.map((c) => c.channel_id).filter((c) => c !== null)),
  ];
  const fixedChannel = ownChannels.length === 1 ? ownChannels[0]! : null;
  const gross = round2(checks.reduce((s, c) => s + Number(c.amount), 0));
  const destinations = accounts.filter(
    (a) =>
      a.is_active &&
      a.currency === currency &&
      a.type !== "checks" &&
      a.type !== "echeq",
  );

  const [key, setKey] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerCuit, setBuyerCuit] = useState("");
  const [accountId, setAccountId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [saleDate, setSaleDate] = useState(todayInAR());
  const [interest, setInterest] = useState("0");
  const [commission, setCommission] = useState("0");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setKey(crypto.randomUUID());
    setBuyerName("");
    setBuyerCuit("");
    setAccountId("");
    setChannelId(fixedChannel ?? "");
    setSaleDate(todayInAR());
    setInterest("0");
    setCommission("0");
    setNotes("");
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const interestN = amountOf(interest);
  const commissionN = amountOf(commission);
  const net = round2(gross - (interestN || 0) - (commissionN || 0));
  const blocker =
    currency === null
      ? "Los cheques de una venta tienen que ser de la misma moneda."
      : ownChannels.length > 1
        ? "Los cheques son de canales distintos: vendelos por separado."
        : null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (blocker) return;
    if (!buyerName.trim()) {
      toast.error("Falta el comprador.");
      return;
    }
    if (!accountId) {
      toast.error("Elegí la cuenta donde entra el neto.");
      return;
    }
    if (!channelId) {
      toast.error("Elegí el canal de la venta.");
      return;
    }
    if (Number.isNaN(interestN) || Number.isNaN(commissionN)) {
      toast.error("Intereses y comisiones tienen que ser importes válidos.");
      return;
    }
    if (net <= 0) {
      toast.error("El neto tiene que ser mayor a cero.");
      return;
    }
    mut.mutate(
      {
        check_ids: checks.map((c) => c.id),
        account_id: accountId,
        channel_id: channelId,
        sale_date: saleDate,
        buyer_name: buyerName,
        buyer_cuit: buyerCuit,
        interest: interestN,
        commission: commissionN,
        notes,
        idempotency_key: key,
      },
      {
        onSuccess: () => {
          toast.success(
            checks.length === 1 ? "Cheque vendido." : "Cheques vendidos.",
          );
          onSold();
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Vender {checks.length === 1 ? "cheque" : `${checks.length} cheques`}
          </DialogTitle>
          <DialogDescription>
            Descuento con un banco o financiera. Los cheques salen de la
            cartera, el neto entra en la cuenta elegida y los intereses y
            comisiones quedan como gasto financiero. Si un cheque vendido se
            rechaza, el comprador lo devuelve y queda como deuda del firmante.
          </DialogDescription>
        </DialogHeader>
        {blocker ? (
          <p className="text-sm">{blocker}</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="sell-buyer" className="text-xs">
                  Comprador
                </Label>
                <Input
                  id="sell-buyer"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  maxLength={120}
                  placeholder="Banco o financiera"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sell-cuit" className="text-xs">
                  CUIT (opcional)
                </Label>
                <Input
                  id="sell-cuit"
                  value={buyerCuit}
                  onChange={(e) => setBuyerCuit(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cuenta donde entra el neto</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegir cuenta" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {destinations.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Canal</Label>
                {fixedChannel ? (
                  <p className="flex h-9 items-center text-sm">
                    {channels.find((c) => c.id === fixedChannel)?.name ??
                      fixedChannel}
                  </p>
                ) : (
                  <Select value={channelId} onValueChange={setChannelId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Elegir canal" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {channels
                        .filter((c) => c.is_active)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fecha</Label>
                <DatePicker value={saleDate} onChange={setSaleDate} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="sell-interest" className="text-xs">
                  Intereses
                </Label>
                <MoneyInput
                  id="sell-interest"
                  value={interest}
                  onChange={setInterest}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sell-commission" className="text-xs">
                  Comisiones y gastos
                </Label>
                <MoneyInput
                  id="sell-commission"
                  value={commission}
                  onChange={setCommission}
                />
              </div>
            </div>
            <dl className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Valor nominal</dt>
                <dd className="font-mono">
                  {formatMoney(gross, currency ?? "ARS")}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Neto a cobrar</dt>
                <dd className="font-mono font-semibold">
                  {formatMoney(net, currency ?? "ARS")}
                </dd>
              </div>
            </dl>
            <div className="space-y-1">
              <Label htmlFor="sell-notes" className="text-xs">
                Notas (opcional)
              </Label>
              <Textarea
                id="sell-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={mut.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={mut.isPending || net <= 0}>
                {mut.isPending ? "Vendiendo…" : "Vender"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
