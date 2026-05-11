"use client";

import { Ban, ArrowLeftRight, Check, HandCoins } from "lucide-react";
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

import {
  useCreditCheque,
  useDepositCheque,
  useEndorseCheque,
  useRejectCheque,
} from "../hooks/use-checks";
import type { Cheque } from "../schema";

const DEFAULT_CHANNEL_ID = "jouve_fiscal";

interface ChannelOption {
  id: string;
  name: string;
}

function todayISO() {
  const d = new Date();
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return ar.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

export function DepositChequeDialog({
  check,
  channels,
}: {
  check: Cheque;
  channels: ChannelOption[];
}) {
  const [open, setOpen] = useState(false);
  const { data: accounts } = useAccountsList();
  const bankAccounts = accounts.filter(
    (a) => a.is_active && a.type === "bank" && a.currency === check.currency,
  );
  const mut = useDepositCheque();

  const [accountId, setAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [channelId, setChannelId] = useState(
    channels.find((c) => c.id === DEFAULT_CHANNEL_ID)?.id ?? channels[0]?.id ?? "",
  );
  const [eventDate, setEventDate] = useState(todayISO());
  const [description, setDescription] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) {
      toast.error("Elegí la cuenta bancaria destino.");
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
            Genera una transferencia desde la cartera a la cuenta bancaria.
            El check pasa a estado depositado hasta que el banco confirme.
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
            <div className="space-y-1">
              <Label className="text-xs">Canal</Label>
              <Select value={channelId} onValueChange={setChannelId}>
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
              <Label className="text-xs">Fecha</Label>
              <Input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
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
  const [eventDate, setEventDate] = useState(todayISO());
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
            Confirma que el banco ya acreditó el monto. La plata ya entró
            con el depósito; este paso solo cierra el lifecycle del check.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Fecha de acreditación</Label>
            <Input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
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
// Endorse
// ---------------------------------------------------------------------------

export function EndorseChequeDialog({
  check,
  channels,
}: {
  check: Cheque;
  channels: ChannelOption[];
}) {
  const [open, setOpen] = useState(false);
  const mut = useEndorseCheque();
  const [channelId, setChannelId] = useState(
    channels.find((c) => c.id === DEFAULT_CHANNEL_ID)?.id ?? channels[0]?.id ?? "",
  );
  const [eventDate, setEventDate] = useState(todayISO());
  const [endorsedToName, setEndorsedToName] = useState("");
  const [endorsedToCuit, setEndorsedToCuit] = useState("");
  const [notes, setNotes] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    mut.mutate(
      {
        check_id: check.id,
        channel_id: channelId,
        event_date: eventDate,
        endorsed_to_name: endorsedToName,
        endorsed_to_cuit: endorsedToCuit,
        notes,
      },
      {
        onSuccess: () => {
          toast.success("Cheque endosado.");
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
          <HandCoins className="size-4" />
          Endosar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Endosar check {check.check_number}</DialogTitle>
          <DialogDescription>
            Entregar el check a un proveedor como pago. Genera un egreso
            en la cuenta de cartera.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Endosado a (razón social)</Label>
            <Input
              value={endorsedToName}
              onChange={(e) => setEndorsedToName(e.target.value)}
              placeholder="Ej. Proveedor SRL"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">CUIT (opcional)</Label>
              <Input
                value={endorsedToCuit}
                onChange={(e) => setEndorsedToCuit(e.target.value)}
                placeholder="30-12345678-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fecha</Label>
              <Input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Canal</Label>
            <Select value={channelId} onValueChange={setChannelId}>
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
              {mut.isPending ? "Endosando…" : "Endosar"}
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

export function RejectChequeDialog({
  check,
  channels,
}: {
  check: Cheque;
  channels: ChannelOption[];
}) {
  const [open, setOpen] = useState(false);
  const { data: accounts } = useAccountsList();
  const bankAccounts = accounts.filter(
    (a) => a.is_active && a.type === "bank" && a.currency === check.currency,
  );
  const mut = useRejectCheque();

  const [accountId, setAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [channelId, setChannelId] = useState(
    channels.find((c) => c.id === DEFAULT_CHANNEL_ID)?.id ?? channels[0]?.id ?? "",
  );
  const [eventDate, setEventDate] = useState(todayISO());
  const [notes, setNotes] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (check.status === "depositado" && !accountId) {
      toast.error("Elegí la cuenta bancaria desde la que se reversa.");
      return;
    }
    mut.mutate(
      {
        check_id: check.id,
        account_id: accountId,
        channel_id: channelId,
        event_date: eventDate,
        notes,
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
            {check.status === "depositado"
              ? "El banco rechazó el check. Se genera un egreso en la cuenta bancaria para revertir el depósito."
              : "Marca el check como rechazado sin afectar cuentas bancarias."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {check.status === "depositado" && (
            <div className="space-y-1">
              <Label className="text-xs">Cuenta bancaria afectada</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue />
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
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Canal</Label>
              <Select value={channelId} onValueChange={setChannelId}>
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
              <Label className="text-xs">Fecha</Label>
              <Input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
            </div>
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
            <Button
              type="submit"
              variant="destructive"
              disabled={mut.isPending}
            >
              {mut.isPending ? "Rechazando…" : "Rechazar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
