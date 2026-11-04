"use client";

import { Ban, ArrowLeftRight, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { todayInAR } from "@/lib/format";
import {
  useAccountOptions,
  useAccountsList,
} from "@/features/accounts/hooks/use-accounts";

import { useRejectSoldCheckAsDebt } from "../hooks/use-check-sales";
import {
  useCreditCheque,
  useDepositCheque,
  useRejectCheque,
} from "../hooks/use-checks";
import type { Cheque } from "../schema";

export interface CheckChannelOption {
  id: string;
  name: string;
  is_active: boolean;
}

// A check keeps the channel of its receipt (or the one it got when first
// deposited, rejected or endorsed): it is shown, not chosen. Only a check
// without channel asks for one, among the active channels.
export function CheckChannelField({
  check,
  channels,
  value,
  onChange,
}: {
  check: Cheque;
  channels: CheckChannelOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (check.channel_id) {
    const name =
      channels.find((c) => c.id === check.channel_id)?.name ?? check.channel_id;
    return (
      <div className="space-y-1">
        <Label className="text-xs">Canal</Label>
        <p className="flex h-9 items-center text-sm">{name}</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Label className="text-xs">Canal</Label>
      <Select value={value} onValueChange={onChange}>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

export function DepositChequeDialog({
  check,
  channels,
}: {
  check: Cheque;
  channels: CheckChannelOption[];
}) {
  const [open, setOpen] = useState(false);
  const { data: accounts } = useAccountsList();
  const bankAccounts = accounts.filter(
    (a) => a.is_active && a.type === "bank" && a.currency === check.currency,
  );
  const mut = useDepositCheque();

  const [accountId, setAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [channelId, setChannelId] = useState(check.channel_id ?? "");
  const [eventDate, setEventDate] = useState(todayInAR());
  const [description, setDescription] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) {
      toast.error("Elegí la cuenta bancaria destino.");
      return;
    }
    if (!channelId) {
      toast.error("Elegí el canal del depósito.");
      return;
    }
    mut.mutate(
      {
        check_id: check.id,
        account_id: accountId,
        channel_id: channelId,
        event_date: eventDate,
        description,
      },
      {
        onSuccess: () => {
          toast.success("Cheque depositado.");
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowLeftRight className="size-4" />
          Depositar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Depositar check {check.check_number}</DialogTitle>
          <DialogDescription>
            Genera una transferencia desde la cartera a la cuenta bancaria. El
            check pasa a estado depositado hasta que el banco confirme.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Cuenta destino</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Elegir banco" />
              </SelectTrigger>
              <SelectContent position="popper">
                {bankAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <CheckChannelField
              check={check}
              channels={channels}
              value={channelId}
              onChange={setChannelId}
            />
            <div className="space-y-1">
              <Label className="text-xs">Fecha</Label>
              <DatePicker value={eventDate} onChange={setEventDate} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Descripción (opcional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={mut.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? "Depositando…" : "Depositar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Credit (depositado → acreditado)
// ---------------------------------------------------------------------------

export function CreditChequeDialog({ check }: { check: Cheque }) {
  const [open, setOpen] = useState(false);
  const mut = useCreditCheque();
  const [eventDate, setEventDate] = useState(todayInAR());
  const [notes, setNotes] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    mut.mutate(
      { check_id: check.id, event_date: eventDate, notes },
      {
        onSuccess: () => {
          toast.success("Cheque acreditado.");
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Check className="size-4" />
          Marcar acreditado
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Acreditar check {check.check_number}</DialogTitle>
          <DialogDescription>
            Confirma que el banco ya acreditó el monto. La plata ya entró con el
            depósito; este paso solo cierra el lifecycle del check.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Fecha de acreditación</Label>
            <DatePicker value={eventDate} onChange={setEventDate} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notas (opcional)</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={mut.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? "Acreditando…" : "Marcar acreditado"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reject
// ---------------------------------------------------------------------------

function rejectDescription(status: Cheque["status"]): string {
  if (status === "depositado") {
    return "El banco rechazó el cheque. Sale de la cuenta donde se depositó y queda como deuda del firmante (Deudores por cheques rechazados).";
  }
  if (status === "endosado") {
    return "El cheque endosado volvió rechazado. La deuda con el proveedor vuelve y el cheque queda como deuda del firmante.";
  }
  if (status === "vendido") {
    return "El cheque vendido volvió rechazado. Se le devuelve el valor al comprador (sale de la cuenta de la venta o de la que elijas) y el cheque queda como deuda del firmante.";
  }
  return "Sale de la cartera y queda como deuda del firmante (Deudores por cheques rechazados).";
}

const SALE_ACCOUNT = "__sale__";
/** A sold check the buyer debits later: no movement now, a debt instead. */
const BUYER_LATER = "__later__";

export function RejectChequeDialog({
  check,
  channels,
  canPickAccount = true,
}: {
  check: Cheque;
  channels: CheckChannelOption[];
  /** Without accounts:read a sold check's repayment cannot pick an account:
   *  it stays against the sale or the buyer's debt. */
  canPickAccount?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rejectMut = useRejectCheque();
  const debtMut = useRejectSoldCheckAsDebt();
  const pending = rejectMut.isPending || debtMut.isPending;
  const { accounts } = useAccountOptions(canPickAccount);
  const repayAccounts = accounts.filter(
    (a) =>
      a.is_active &&
      a.currency === check.currency &&
      a.type !== "checks" &&
      a.type !== "echeq",
  );

  const [channelId, setChannelId] = useState(check.channel_id ?? "");
  const [repayAccountId, setRepayAccountId] = useState(SALE_ACCOUNT);
  const [eventDate, setEventDate] = useState(todayInAR());
  const [notes, setNotes] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (check.status === "vendido" && repayAccountId === BUYER_LATER) {
      debtMut.mutate(
        { check_id: check.id, event_date: eventDate, notes },
        {
          onSuccess: () => {
            toast.success(
              "Cheque rechazado: queda la deuda con el comprador para pagar después.",
            );
            setOpen(false);
          },
          onError: (err) => toast.error(err.message),
        },
      );
      return;
    }
    if (!channelId) {
      toast.error("Elegí el canal del rechazo.");
      return;
    }
    rejectMut.mutate(
      {
        check_id: check.id,
        channel_id: channelId,
        event_date: eventDate,
        notes,
        account_id:
          check.status === "vendido" && repayAccountId !== SALE_ACCOUNT
            ? repayAccountId
            : null,
      },
      {
        onSuccess: () => {
          toast.success("Cheque rechazado.");
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Ban className="size-4" />
          Rechazar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rechazar check {check.check_number}</DialogTitle>
          <DialogDescription>
            {rejectDescription(check.status)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <CheckChannelField
              check={check}
              channels={channels}
              value={channelId}
              onChange={setChannelId}
            />
            <div className="space-y-1">
              <Label className="text-xs">Fecha</Label>
              <DatePicker value={eventDate} onChange={setEventDate} />
            </div>
          </div>
          {check.status === "vendido" && (
            <div className="space-y-1">
              <Label className="text-xs">Cuenta de la devolución</Label>
              <Select value={repayAccountId} onValueChange={setRepayAccountId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={SALE_ACCOUNT}>
                    La cuenta de la venta
                  </SelectItem>
                  <SelectItem value={BUYER_LATER}>
                    Todavía no lo debitó (queda como deuda)
                  </SelectItem>
                  {repayAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Notas (opcional)</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Rechazando…" : "Rechazar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
