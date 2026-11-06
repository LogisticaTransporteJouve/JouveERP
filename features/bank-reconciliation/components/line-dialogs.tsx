"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ChannelsReadError } from "@/components/channels-read-error";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CostTagSelect } from "@/features/cost-centers/components/cost-tag-select";
import {
  formatArgentineDate,
  formatMoney,
  formatMoneySigned,
  formatPeriod,
  round2,
} from "@/lib/format";

import {
  useCreateLineTaxPayment,
  useCreateLineTransaction,
  useIgnoreLine,
  useMatchLine,
  useMatchLinesToMovement,
  usePayableTaxDocuments,
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

/** Pick the lines a movement was split into by the bank: several pending
 *  lines whose amounts add up to the movement's. */
export function MatchMovementLinesDialog({
  movement,
  lines,
  currency,
  onOpenChange,
}: {
  movement: BookMovement | null;
  /** The period's pending lines. */
  lines: readonly StatementLine[];
  currency: string;
  onOpenChange: (open: boolean) => void;
}) {
  const match = useMatchLinesToMovement();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Same direction first, closest date first.
  const options = movement
    ? lines
        .filter((l) => l.status === "open")
        .sort(
          (a, b) =>
            Number(Math.sign(b.amount) === Math.sign(movement.signed_amount)) -
              Number(
                Math.sign(a.amount) === Math.sign(movement.signed_amount),
              ) ||
            Math.abs(
              Date.parse(a.line_date) - Date.parse(movement.transaction_date),
            ) -
              Math.abs(
                Date.parse(b.line_date) - Date.parse(movement.transaction_date),
              ),
        )
    : [];
  const total = sumAmounts(
    options.filter((l) => selected.has(l.id)).map((l) => l.amount),
  );
  const diff = movement ? sumAmounts([movement.signed_amount, -total]) : 0;

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
    if (!movement) return;
    match.mutate(
      { line_ids: [...selected], transaction_id: movement.id },
      {
        onSuccess: () => {
          toast.success(
            selected.size === 1
              ? "Línea conciliada."
              : `${selected.size} líneas conciliadas con el movimiento.`,
          );
          close();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={movement !== null} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Conciliar con varias líneas</DialogTitle>
          <DialogDescription>
            Cuando el banco parte un movimiento (un depósito o una transferencia
            en dos o más líneas), elegí las líneas que suman su importe.
            Desconciliar una de ellas desconcilia todas.
          </DialogDescription>
        </DialogHeader>
        {movement && (
          <div className="rounded-md border px-3 py-2 text-sm">
            <p className="font-medium">
              {movement.description || "(sin descripción)"}
            </p>
            <p className="text-muted-foreground">
              {formatArgentineDate(movement.transaction_date)} ·{" "}
              <span className="tabular-nums">
                {formatMoneySigned(movement.signed_amount, currency)}
              </span>
            </p>
          </div>
        )}
        <div className="max-h-80 space-y-1 overflow-auto rounded-md border p-2">
          {options.length === 0 && (
            <p className="text-muted-foreground p-2 text-sm">
              No hay líneas pendientes en el extracto de este mes.
            </p>
          )}
          {options.map((l) => (
            <label
              key={l.id}
              className="hover:bg-accent/50 flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm"
            >
              <Checkbox
                checked={selected.has(l.id)}
                onCheckedChange={(v) => toggle(l.id, v === true)}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{l.description}</span>
                <span className="text-muted-foreground block text-xs">
                  {formatArgentineDate(l.line_date)}
                  {l.reference ? ` · Ref. ${l.reference}` : ""}
                </span>
              </span>
              <span className="tabular-nums">
                {formatMoneySigned(l.amount, currency)}
              </span>
            </label>
          ))}
        </div>
        <p className="text-sm tabular-nums">
          Elegidas: {formatMoneySigned(total, currency)}
          {selected.size > 0 && diff !== 0 && (
            <span className="text-muted-foreground">
              {" "}
              · faltan {formatMoneySigned(diff, currency)} para el movimiento
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

type CreateMode = "manual" | "tax";

/** Create the movement the books lack (a bank fee, interest) and reconcile
 *  it with the line; a debit in pesos can instead be booked as the payment
 *  of a tax document. */
export function CreateLineTransactionDialog({
  line,
  currency,
  canPayTaxes,
  onOpenChange,
}: {
  line: StatementLine | null;
  currency: string;
  /** taxes:write: offers "Pago de impuesto" for a debit in pesos. */
  canPayTaxes: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateLineTransaction();
  const createTax = useCreateLineTaxPayment();
  const { channels } = useScope();
  const active = channels.filter((c) => c.is_active);
  const [mode, setMode] = useState<CreateMode>("manual");
  const [channelId, setChannelId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [description, setDescription] = useState<string | null>(null);
  const [taxDocumentId, setTaxDocumentId] = useState("");
  const [confirmDifference, setConfirmDifference] = useState(false);
  const isDebit = (line?.amount ?? 0) < 0;
  const offersTax = canPayTaxes && isDebit && currency === "ARS";
  const isTax = offersTax && mode === "tax";
  const payable = usePayableTaxDocuments(line !== null && isTax);
  const text = description ?? line?.description ?? "";
  const taxDoc = payable.data?.find((d) => d.id === taxDocumentId) ?? null;
  const lineAmount = line ? Math.abs(line.amount) : 0;
  const difference =
    taxDoc && taxDoc.amount !== null ? round2(lineAmount - taxDoc.amount) : 0;
  const pending = create.isPending || createTax.isPending;

  function close() {
    setMode("manual");
    setChannelId("");
    setExpenseAccountId("");
    setCostCenterId("");
    setDescription(null);
    setTaxDocumentId("");
    setConfirmDifference(false);
    onOpenChange(false);
  }

  function submit() {
    if (!line) return;
    if (isTax) {
      createTax.mutate(
        {
          line_id: line.id,
          tax_document_id: taxDocumentId,
          allow_difference: difference !== 0 && confirmDifference,
        },
        {
          onSuccess: () => {
            toast.success("Impuesto pagado y línea conciliada.");
            close();
          },
          onError: (err) => toast.error(err.message),
        },
      );
      return;
    }
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

  const disabled = isTax
    ? taxDocumentId === "" ||
      (difference !== 0 && !confirmDifference) ||
      pending
    : channelId === "" || (isDebit && expenseAccountId === "") || pending;

  return (
    <Dialog open={line !== null} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isDebit ? "Crear egreso" : "Crear ingreso"} desde el extracto
          </DialogTitle>
          <DialogDescription>
            {isTax
              ? "Se registra como el pago del impuesto elegido, con la fecha, la cuenta y el importe de la línea: un egreso del canal fiscal con su asiento contra la cuenta del impuesto, conciliado con la línea."
              : "Se carga en Caja como un movimiento manual de esta cuenta, con la fecha y el importe de la línea, y queda conciliado con ella."}
          </DialogDescription>
        </DialogHeader>
        {line && <LineSummary line={line} currency={currency} />}
        <div className="grid gap-3">
          {offersTax && (
            <div className="space-y-1.5">
              <Label htmlFor="line-tx-mode">Tipo</Label>
              <Select
                value={mode}
                onValueChange={(v) => setMode(v === "tax" ? "tax" : "manual")}
              >
                <SelectTrigger id="line-tx-mode" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Egreso manual</SelectItem>
                  <SelectItem value="tax">Pago de impuesto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {isTax ? (
            <div className="space-y-1.5">
              <Label htmlFor="line-tx-tax">Impuesto</Label>
              {payable.isPending ? (
                <Skeleton className="h-9 w-full" />
              ) : payable.isError ? (
                <p className="text-sm">{payable.error.message}</p>
              ) : payable.data.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No hay impuestos pendientes o liquidados con su cuenta
                  contable elegida.
                </p>
              ) : (
                <Select
                  value={taxDocumentId || undefined}
                  onValueChange={(v) => {
                    setTaxDocumentId(v);
                    setConfirmDifference(false);
                  }}
                >
                  <SelectTrigger id="line-tx-tax" className="w-full min-w-0">
                    <SelectValue placeholder="Elegí el impuesto" />
                  </SelectTrigger>
                  <SelectContent>
                    {payable.data.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.label} · {formatPeriod(d.period)} · vence{" "}
                        {formatArgentineDate(d.due_date)}
                        {d.amount !== null ? ` · ${formatMoney(d.amount)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {taxDoc && difference !== 0 && (
                <div className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    id="line-tx-difference"
                    checked={confirmDifference}
                    onCheckedChange={(v) => setConfirmDifference(v === true)}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="line-tx-difference"
                    className="leading-snug font-normal"
                  >
                    La línea es de {formatMoney(lineAmount)} y el impuesto de{" "}
                    {formatMoney(taxDoc.amount)}. Registrar el pago igual: queda
                    por el importe de la línea y la diferencia en las notas.
                  </Label>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="line-tx-channel">Canal</Label>
                <Select
                  value={channelId || undefined}
                  onValueChange={setChannelId}
                >
                  <SelectTrigger
                    id="line-tx-channel"
                    className="w-full min-w-0"
                  >
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
                <ChannelsReadError inline />
              </div>
              {isDebit && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button type="button" disabled={disabled} onClick={submit}>
            {isTax
              ? pending
                ? "Registrando…"
                : "Pagar y conciliar"
              : pending
                ? "Creando…"
                : "Crear y conciliar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
