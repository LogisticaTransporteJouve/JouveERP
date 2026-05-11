"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

import { useCreateCheque } from "../hooks/use-checks";
import {
  CHEQUE_CURRENCIES,
  CHECK_KINDS,
  CHECK_KIND_LABEL,
  type ChequeCurrency,
  type ChequeKind,
} from "../schema";

function todayISO() {
  const d = new Date();
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return ar.toISOString().slice(0, 10);
}

export function NewChequeDialog() {
  const [open, setOpen] = useState(false);
  const { data: accounts } = useAccountsList();
  const carteraOptions = accounts.filter(
    (a) => a.is_active && (a.type === "checks" || a.type === "echeq"),
  );
  const createMut = useCreateCheque();

  const [kind, setKind] = useState<ChequeKind>("fisico");
  const [chequeNumber, setChequeNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [drawerName, setDrawerName] = useState("");
  const [drawerCuit, setDrawerCuit] = useState("");
  const [issueDate, setIssueDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<ChequeCurrency>("ARS");
  const [carteraAccountId, setCarteraAccountId] = useState<string>(() => {
    // Pre-pick the first cartera account that matches the default kind.
    const match = carteraOptions.find((a) => a.type === "checks");
    return match?.id ?? carteraOptions[0]?.id ?? "";
  });
  const [notes, setNotes] = useState("");

  function reset() {
    setKind("fisico");
    setChequeNumber("");
    setBankName("");
    setDrawerName("");
    setDrawerCuit("");
    setIssueDate(todayISO());
    setDueDate(todayISO());
    setAmount("");
    setCurrency("ARS");
    setNotes("");
  }

  function onKindChange(next: ChequeKind) {
    setKind(next);
    // Auto-pick the cartera account that matches the selected kind.
    const target = next === "fisico" ? "checks" : "echeq";
    const match = carteraOptions.find((a) => a.type === target);
    if (match) setCarteraAccountId(match.id);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!carteraAccountId) {
      toast.error("Configurá una cuenta de cartera primero (Cheques físicos o e-cheq).");
      return;
    }
    createMut.mutate(
      {
        kind,
        check_number: chequeNumber,
        bank_name: bankName,
        drawer_name: drawerName,
        drawer_cuit: drawerCuit,
        issue_date: issueDate,
        due_date: dueDate,
        amount,
        currency,
        cartera_account_id: carteraAccountId,
        source_kind: "manual",
        notes,
      },
      {
        onSuccess: () => {
          toast.success("Cheque registrado.");
          reset();
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Nuevo check
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo check</DialogTitle>
          <DialogDescription>
            Carga manual. Cuando un cliente paga con check vía un recibo,
            el check se va a registrar automáticamente desde el recibo (en
            una iteración siguiente).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-[140px_1fr_140px]">
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={kind} onValueChange={(v) => onKindChange(v as ChequeKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {CHECK_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {CHECK_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Número de check</Label>
              <Input
                value={chequeNumber}
                onChange={(e) => setChequeNumber(e.target.value)}
                placeholder="Ej. 00012345"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Moneda</Label>
              <Select
                value={currency}
                onValueChange={(v) => setCurrency(v as ChequeCurrency)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {CHEQUE_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Banco emisor</Label>
              <Input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Ej. Banco Galicia"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cuenta de cartera</Label>
              <Select
                value={carteraAccountId}
                onValueChange={setCarteraAccountId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Elegir cuenta" />
                </SelectTrigger>
                <SelectContent position="popper">
                  {carteraOptions.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Firmante (razón social)</Label>
              <Input
                value={drawerName}
                onChange={(e) => setDrawerName(e.target.value)}
                placeholder="Ej. Cliente SRL"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CUIT firmante (opcional)</Label>
              <Input
                value={drawerCuit}
                onChange={(e) => setDrawerCuit(e.target.value)}
                placeholder="30-12345678-9"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Fecha de emisión</Label>
              <Input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fecha de cobro</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Monto</Label>
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
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

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={createMut.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Registrando…" : "Registrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
