"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useScope } from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CostTagSelect } from "@/features/cost-centers/components/cost-tag-select";
import { formatArgentineDate, formatMoneySigned } from "@/lib/format";

import {
  useCreateLineTransaction,
  useIgnoreLine,
  useMatchLine,
} from "../hooks/use-reconciliation";
import { sumAmounts } from "../lib/reconcile";
import type { BookMovement, StatementLine } from "../schema";

function LineSummary({
  line,
  currency,
}: {
  line: StatementLine;
  currency: string;
}) {
  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <p className="font-medium">{line.description}</p>
      <p className="text-muted-foreground">
        {formatArgentineDate(line.line_date)} ·{" "}
        <span className="tabular-nums">
          {formatMoneySigned(line.amount, currency)}
        </span>
        {line.reference ? ` · Ref. ${line.reference}` : ""}
      </p>
    </div>
  );
}

/** Pick the movements that explain a line: one or several, adding up to it. */
export function MatchLineDialog({
  line,
  movements,
  currency,
  onOpenChange,
}: {
  line: StatementLine | null;
  /** The account's movements not reconciled yet. */
  movements: readonly BookMovement[];
  currency: string;
  onOpenChange: (open: boolean) => void;
}) {
  const match = useMatchLine();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const open = line !== null;
  // Same direction first, closest date first.
  const options = line
    ? [...movements].sort(
        (a, b) =>
          Number(Math.sign(b.signed_amount) === Math.sign(line.amount)) -
            Number(Math.sign(a.signed_amount) === Math.sign(line.amount)) ||
          Math.abs(
            Date.parse(a.transaction_date) - Date.parse(line.line_date),
          ) -
            Math.abs(
              Date.parse(b.transaction_date) - Date.parse(line.line_date),
            ),
      )
    : [];
  const total = sumAmounts(
    options.filter((m) => selected.has(m.id)).map((m) => m.signed_amount),
  );
  const diff = line ? sumAmounts([line.amount, -total]) : 0;

  function close() {
    setSelected(new Set());
    onOpenChange(false);
  }

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  function submit() {
    if (!line) return;
    match.mutate(
      { line_id: line.id, transaction_ids: [...selected] },
      {
        onSuccess: () => {
          toast.success("Línea conciliada.");
          close();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Conciliar línea</DialogTitle>
          <DialogDescription>
            Elegí el movimiento de la cuenta que la explica, o varios que sumen
            su importe. Mientras esté conciliado, el movimiento no se edita ni
            se borra.
          </DialogDescription>
        </DialogHeader>
        {line && <LineSummary line={line} currency={currency} />}
        <div className="max-h-80 space-y-1 overflow-auto rounded-md border p-2">
          {options.length === 0 && (
            <p className="text-muted-foreground p-2 text-sm">
              No hay movimientos sin conciliar de esta cuenta cerca de la fecha.
              Podés crear el movimiento desde la línea.
            </p>
          )}
          {options.map((m) => (
            <label
              key={m.id}
              className="hover:bg-accent/50 flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm"
            >
              <Checkbox
                checked={selected.has(m.id)}
                onCheckedChange={(v) => toggle(m.id, v === true)}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {m.description || "(sin descripción)"}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {formatArgentineDate(m.transaction_date)}
                </span>
              </span>
              <span className="tabular-nums">
                {formatMoneySigned(m.signed_amount, currency)}
              </span>
            </label>
          ))}
        </div>
        <p className="text-sm tabular-nums">
          Elegidos: {formatMoneySigned(total, currency)}
          {selected.size > 0 && diff !== 0 && (
            <span className="text-muted-foreground">
              {" "}
              · faltan {formatMoneySigned(diff, currency)} para la línea
            </span>
          )}
        </p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={selected.size === 0 || diff !== 0 || match.isPending}
            onClick={submit}
          >
            {match.isPending ? "Conciliando…" : "Conciliar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Mark a line "no corresponde", with its reason. */
export function IgnoreLineDialog({
  line,
  currency,
  onOpenChange,
}: {
  line: StatementLine | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
}) {
  const ignore = useIgnoreLine();
  const [reason, setReason] = useState("");

  function close() {
    setReason("");
    onOpenChange(false);
  }

  return (
    <Dialog open={line !== null} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>No corresponde</DialogTitle>
          <DialogDescription>
            La línea queda fuera de la conciliación con su motivo (por ejemplo,
            un movimiento entre cuentas propias ya conciliado del otro lado). Se
            puede volver a pendiente.
          </DialogDescription>
        </DialogHeader>
        {line && <LineSummary line={line} currency={currency} />}
        <div className="space-y-1.5">
          <Label htmlFor="ignore-reason">Motivo</Label>
          <Textarea
            id="ignore-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={reason.trim() === "" || ignore.isPending}
            onClick={() => {
              if (!line) return;
              ignore.mutate(
                { line_id: line.id, reason },
                {
                  onSuccess: () => {
                    toast.success("Línea marcada como que no corresponde.");
                    close();
                  },
                  onError: (err) => toast.error(err.message),
                },
              );
            }}
          >
            {ignore.isPending ? "Guardando…" : "Marcar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Create the movement the books lack (a bank fee, interest) and reconcile
 *  it with the line. */
export function CreateLineTransactionDialog({
  line,
  currency,
  onOpenChange,
}: {
  line: StatementLine | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateLineTransaction();
  const { channels } = useScope();
  const active = channels.filter((c) => c.is_active);
  const [channelId, setChannelId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [description, setDescription] = useState<string | null>(null);
  const isDebit = (line?.amount ?? 0) < 0;
  const text = description ?? line?.description ?? "";

  function close() {
    setChannelId("");
    setExpenseAccountId("");
    setCostCenterId("");
    setDescription(null);
    onOpenChange(false);
  }

  function submit() {
    if (!line) return;
    create.mutate(
      {
        line_id: line.id,
        channel_id: channelId,
        expense_account_id: isDebit ? expenseAccountId : "",
        cost_center_id: isDebit ? costCenterId : "",
        description: text,
      },
      {
        onSuccess: () => {
          toast.success("Movimiento creado y conciliado.");
          close();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={line !== null} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isDebit ? "Crear egreso" : "Crear ingreso"} desde el extracto
          </DialogTitle>
          <DialogDescription>
            Se carga en Caja como un movimiento manual de esta cuenta, con la
            fecha y el importe de la línea, y queda conciliado con ella.
          </DialogDescription>
        </DialogHeader>
        {line && <LineSummary line={line} currency={currency} />}
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="line-tx-channel">Canal</Label>
            <Select value={channelId || undefined} onValueChange={setChannelId}>
              <SelectTrigger id="line-tx-channel" className="w-full min-w-0">
                <SelectValue placeholder="Elegí el canal" />
              </SelectTrigger>
              <SelectContent>
                {active.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isDebit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label>Cuenta de gasto</Label>
                <CostTagSelect
                  kind="expenseAccount"
                  value={expenseAccountId}
                  onChange={setExpenseAccountId}
                  noneLabel="Elegí la cuenta"
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label>Centro de costo</Label>
                <CostTagSelect
                  kind="costCenter"
                  value={costCenterId}
                  onChange={setCostCenterId}
                />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="line-tx-description">Descripción</Label>
            <Input
              id="line-tx-description"
              maxLength={500}
              value={text}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={
              channelId === "" ||
              (isDebit && expenseAccountId === "") ||
              create.isPending
            }
            onClick={submit}
          >
            {create.isPending ? "Creando…" : "Crear y conciliar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
