"use client";

import { Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MoneyInput } from "@/components/money-input";
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
  amountToInput,
  formatArgentineDate,
  formatMoneyWithCode,
  parseArAmount,
  todayInAR,
} from "@/lib/format";

import {
  ACCOUNT_CURRENCIES,
  ACCOUNT_MOVEMENT_KIND_LABEL,
  CREDITOR_LABEL,
  CREDITORS,
  isAccountCurrency,
  isCreditor,
  isDebitKind,
  isPlanStatus,
  movementSource,
  PLAN_STATUS_LABEL,
  PLAN_STATUSES,
  type AccountCurrency,
  type AccountMovement,
  type Creditor,
  type DebtPlan,
  type PlanStatus,
} from "../account-schema";
import {
  useCreateDebtPlan,
  useCreateManualMovement,
  useDeleteAccountMovement,
  useDeleteDebtPlan,
  useEmployeeAccount,
  useSetDebtPlanStatus,
  useUpdateDebtPlan,
} from "../hooks/use-employee-account";
import { HR_CASH_DENIED_REASON, movementMovesCash } from "../lib/hr-cash";

import { EmployeeCashDialog } from "./employee-cash-dialog";

const SOURCE_LABEL: Record<ReturnType<typeof movementSource>, string> = {
  cash: "Caja",
  purchase: "Compra",
  payroll: "Planilla",
  settlement: "Rendición",
  forgiveness: "Plan",
  manual: "Manual",
};

function monthLabel(isoFirstDay: string): string {
  const [y, m] = isoFirstDay.split("-");
  return `${m}/${y}`;
}

/**
 * Cuenta corriente del empleado (D1): what the employee owes per currency,
 * the plans that pay it back (their installment is the planilla's default
 * Deudas) and every movement. `canMoveCash` (hr:write + transactions:write)
 * shows the advance and payment buttons.
 */
export function EmployeeAccountCard({
  employeeId,
  employeeName,
  canWrite,
  canMoveCash,
}: {
  employeeId: string;
  employeeName: string;
  canWrite: boolean;
  canMoveCash: boolean;
}) {
  const { data, isPending, isError, error } = useEmployeeAccount(employeeId);
  const deleteMovement = useDeleteAccountMovement(employeeId);
  const [manualOpen, setManualOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<DebtPlan | null>(null);

  const plans = data?.plans ?? [];

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Wallet className="size-4 text-muted-foreground" />
            Cuenta corriente
          </h2>
          <p className="text-xs text-muted-foreground">
            Adelantos, compras a su cargo y deudas. No son costo: se devuelven
            con descuentos de planilla (la cuota de cada plan activo en pesos) o
            con pagos.
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {canMoveCash && (
              <>
                <EmployeeCashDialog
                  kind="advance"
                  employeeId={employeeId}
                  employeeName={employeeName}
                  trigger={
                    <Button variant="outline" size="sm">
                      Adelanto
                    </Button>
                  }
                />
                <EmployeeCashDialog
                  kind="payment"
                  employeeId={employeeId}
                  employeeName={employeeName}
                  plans={plans}
                  trigger={
                    <Button variant="outline" size="sm">
                      Pago en caja
                    </Button>
                  }
                />
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManualOpen(true)}
            >
              <Plus className="size-4" />
              Movimiento
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingPlan(null);
                setPlanOpen(true);
              }}
            >
              <Plus className="size-4" />
              Plan
            </Button>
          </div>
        )}
      </div>

      {isPending ? (
        <p className="mt-3 text-sm text-muted-foreground">Cargando…</p>
      ) : isError ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No se pudo leer la cuenta corriente: {error.message}
        </p>
      ) : (
        <div className="mt-3 space-y-4 text-sm">
          <dl className="flex flex-wrap gap-x-8 gap-y-2">
            {data.balances.length === 0 ? (
              <div>
                <dt className="text-xs text-muted-foreground">Saldo</dt>
                <dd className="font-mono">Sin movimientos</dd>
              </div>
            ) : (
              data.balances.map((b) => (
                <div key={b.currency}>
                  <dt className="text-xs text-muted-foreground">
                    {b.balance >= 0
                      ? `Debe (${b.currency})`
                      : `A favor del empleado (${b.currency})`}
                  </dt>
                  <dd className="font-mono text-base font-semibold">
                    {formatMoneyWithCode(Math.abs(b.balance), b.currency)}
                  </dd>
                  {b.balance_socio !== 0 && (
                    <dd className="text-xs text-muted-foreground">
                      De eso, con socios:{" "}
                      {formatMoneyWithCode(b.balance_socio, b.currency)}
                    </dd>
                  )}
                </div>
              ))
            )}
          </dl>

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Planes
            </h3>
            {plans.length === 0 ? (
              <p className="text-muted-foreground">Sin planes.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {plans.map((p) => (
                  <PlanRow
                    key={p.id}
                    plan={p}
                    employeeId={employeeId}
                    canWrite={canWrite}
                    onEdit={() => {
                      setEditingPlan(p);
                      setPlanOpen(true);
                    }}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Movimientos
            </h3>
            {data.movements.length === 0 ? (
              <p className="text-muted-foreground">Sin movimientos.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left font-medium">Fecha</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Concepto
                      </th>
                      <th className="px-3 py-2 text-right font-medium">Debe</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Haber
                      </th>
                      {canWrite && <th className="w-10" />}
                    </tr>
                  </thead>
                  <tbody>
                    {data.movements.map((m) => (
                      <MovementRow
                        key={m.id}
                        movement={m}
                        canWrite={canWrite}
                        canMoveCash={canMoveCash}
                        deleting={deleteMovement.isPending}
                        onDelete={() =>
                          deleteMovement.mutate(m.id, {
                            onSuccess: () =>
                              toast.success("Movimiento borrado."),
                            onError: (err) => toast.error(err.message),
                          })
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.movements_partial && (
              <p className="text-xs text-muted-foreground">
                Se muestran los 500 movimientos más recientes; el saldo incluye
                todos.
              </p>
            )}
          </section>
        </div>
      )}

      {canWrite && manualOpen && (
        <ManualMovementDialog
          employeeId={employeeId}
          plans={plans}
          open={manualOpen}
          onOpenChange={setManualOpen}
        />
      )}
      {canWrite && planOpen && (
        <PlanDialog
          employeeId={employeeId}
          plan={editingPlan}
          open={planOpen}
          onOpenChange={setPlanOpen}
        />
      )}
    </div>
  );
}

function PlanRow({
  plan,
  employeeId,
  canWrite,
  onEdit,
}: {
  plan: DebtPlan;
  employeeId: string;
  canWrite: boolean;
  onEdit: () => void;
}) {
  const statusMut = useSetDebtPlanStatus(employeeId);
  const deleteMut = useDeleteDebtPlan(employeeId);
  const confirm = useConfirm();
  const settled = plan.remaining <= 0;
  const closed = plan.status === "condonado";

  async function setStatus(status: PlanStatus) {
    if (status === "condonado") {
      const ok = await confirm({
        title: "Condonar plan",
        description: `Se perdona lo que resta (${formatMoneyWithCode(Math.max(plan.remaining, 0), plan.currency)}) de "${plan.description}": baja la cuenta corriente y no se puede deshacer.`,
        confirmLabel: "Condonar",
        tone: "destructive",
      });
      if (!ok) return;
    }
    statusMut.mutate(
      { id: plan.id, status },
      {
        onSuccess: () =>
          toast.success(`Plan ${PLAN_STATUS_LABEL[status].toLowerCase()}.`),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className="font-medium">
          {plan.description}
          <Badge variant="outline" className="ml-2 text-[10px] font-normal">
            {settled && !closed ? "Saldado" : PLAN_STATUS_LABEL[plan.status]}
          </Badge>
        </p>
        <p className="text-xs text-muted-foreground">
          {formatMoneyWithCode(plan.installment_amount, plan.currency)} por mes
          desde {monthLabel(plan.start_month)} · pagado{" "}
          {formatMoneyWithCode(plan.paid, plan.currency)} de{" "}
          {formatMoneyWithCode(plan.total, plan.currency)} · resta{" "}
          {formatMoneyWithCode(Math.max(plan.remaining, 0), plan.currency)}
          {plan.creditor === "socio"
            ? ` · acreedor: ${plan.creditor_name ?? "socio"}`
            : ""}
          {plan.currency !== "ARS" ? " · no se descuenta en la planilla" : ""}
        </p>
      </div>
      {canWrite && !closed && (
        <div className="flex items-center gap-1">
          <Select
            value={plan.status}
            onValueChange={(v) => {
              if (isPlanStatus(v) && v !== plan.status) void setStatus(v);
            }}
            disabled={statusMut.isPending}
          >
            <SelectTrigger
              className="h-8 w-32 text-xs"
              aria-label="Estado del plan"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAN_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {PLAN_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Editar plan"
            onClick={onEdit}
          >
            <Pencil className="size-3.5" />
          </Button>
          {plan.paid === 0 && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Borrar plan"
              disabled={deleteMut.isPending}
              onClick={() =>
                deleteMut.mutate(plan.id, {
                  onSuccess: () => toast.success("Plan borrado."),
                  onError: (err) => toast.error(err.message),
                })
              }
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function MovementRow({
  movement: m,
  canWrite,
  canMoveCash,
  deleting,
  onDelete,
}: {
  movement: AccountMovement;
  canWrite: boolean;
  canMoveCash: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const source = movementSource(m);
  const debit = isDebitKind(m.kind);
  const deletable = source === "manual" || source === "cash";
  // Same predicate as deleteAccountMovementAction.
  const cashDenied = movementMovesCash(m) && !canMoveCash;
  const amount = formatMoneyWithCode(m.amount, m.currency);
  return (
    <tr className="border-b last:border-0">
      <td className="whitespace-nowrap px-3 py-2">
        {formatArgentineDate(m.movement_date)}
      </td>
      <td className="px-3 py-2">
        <div>{m.description}</div>
        <div className="text-xs text-muted-foreground">
          {ACCOUNT_MOVEMENT_KIND_LABEL[m.kind]} · {SOURCE_LABEL[source]}
          {m.plan_description ? ` · plan ${m.plan_description}` : ""}
          {m.creditor === "socio" ? " · socio" : ""}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
        {debit ? amount : ""}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
        {debit ? "" : amount}
      </td>
      {canWrite && (
        <td className="px-1 py-2 text-right">
          {deletable && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={
                source === "cash"
                  ? "Borrar el movimiento y su movimiento de caja"
                  : "Borrar movimiento"
              }
              title={
                cashDenied
                  ? HR_CASH_DENIED_REASON
                  : source === "cash"
                    ? "Borra también el movimiento de caja"
                    : undefined
              }
              disabled={deleting || cashDenied}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}

const NONE = "__none__";

function ManualMovementDialog({
  employeeId,
  plans,
  open,
  onOpenChange,
}: {
  employeeId: string;
  plans: DebtPlan[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mutation = useCreateManualMovement(employeeId);
  const [kind, setKind] = useState<"charge" | "payment">("charge");
  const [currency, setCurrency] = useState<AccountCurrency>("ARS");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayInAR());
  const [description, setDescription] = useState("");
  const [creditor, setCreditor] = useState<Creditor>("empresa");
  const [planId, setPlanId] = useState(NONE);
  const plansOfCurrency = plans.filter(
    (p) => p.currency === currency && p.status !== "condonado",
  );

  function onSave() {
    mutation.mutate(
      {
        employee_id: employeeId,
        kind,
        currency,
        amount: parseArAmount(amount) ?? Number.NaN,
        movement_date: date,
        description,
        creditor,
        plan_id: planId === NONE ? null : planId,
      },
      {
        onSuccess: () => {
          toast.success("Movimiento cargado.");
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
          <DialogTitle>Movimiento manual</DialogTitle>
          <DialogDescription>
            Una deuda o un pago que no pasa por la caja: un préstamo de un
            socio, un saldo inicial, un pago recibido afuera. Para un adelanto o
            un pago en efectivo o transferencia usá los botones de caja.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="manual-kind">Tipo</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                if (v === "charge" || v === "payment") setKind(v);
              }}
            >
              <SelectTrigger id="manual-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="charge">Cargo (el empleado debe)</SelectItem>
                <SelectItem value="payment">Pago (baja la deuda)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-creditor">Acreedor</Label>
            <Select
              value={creditor}
              onValueChange={(v) => {
                if (isCreditor(v)) setCreditor(v);
              }}
            >
              <SelectTrigger id="manual-creditor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREDITORS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CREDITOR_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-currency">Moneda</Label>
            <Select
              value={currency}
              onValueChange={(v) => {
                if (isAccountCurrency(v)) {
                  setCurrency(v);
                  setPlanId(NONE);
                }
              }}
            >
              <SelectTrigger id="manual-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-amount">Importe</Label>
            <MoneyInput
              id="manual-amount"
              className="text-right font-mono"
              value={amount}
              onChange={setAmount}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-date">Fecha</Label>
            <Input
              id="manual-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-plan">Plan (opcional)</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger id="manual-plan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin plan</SelectItem>
                {plansOfCurrency.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="manual-description">Descripción</Label>
            <Input
              id="manual-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={mutation.isPending}>
            {mutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanDialog({
  employeeId,
  plan,
  open,
  onOpenChange,
}: {
  employeeId: string;
  plan: DebtPlan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreateDebtPlan(employeeId);
  const updateMut = useUpdateDebtPlan(employeeId);
  const pending = createMut.isPending || updateMut.isPending;
  const [description, setDescription] = useState(plan?.description ?? "");
  const [currency, setCurrency] = useState<AccountCurrency>(
    plan?.currency ?? "ARS",
  );
  const [total, setTotal] = useState(plan ? amountToInput(plan.total) : "");
  const [installment, setInstallment] = useState(
    plan ? amountToInput(plan.installment_amount) : "",
  );
  const [startMonth, setStartMonth] = useState(
    plan ? plan.start_month.slice(0, 7) : todayInAR().slice(0, 7),
  );
  const [creditor, setCreditor] = useState<Creditor>(
    plan?.creditor ?? "empresa",
  );
  const [creditorName, setCreditorName] = useState(plan?.creditor_name ?? "");
  const [notes, setNotes] = useState(plan?.notes ?? "");

  function onSave() {
    const payload = {
      description,
      total: parseArAmount(total) ?? Number.NaN,
      installment_amount: parseArAmount(installment) ?? Number.NaN,
      start_month: startMonth,
      creditor,
      creditor_name: creditorName,
      notes,
    };
    const callbacks = {
      onSuccess: () => {
        toast.success(plan ? "Plan actualizado." : "Plan cargado.");
        onOpenChange(false);
      },
      onError: (err: Error) => toast.error(err.message),
    };
    if (plan) {
      updateMut.mutate({ ...payload, id: plan.id }, callbacks);
    } else {
      createMut.mutate(
        { ...payload, employee_id: employeeId, currency },
        callbacks,
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan ? "Editar plan" : "Nuevo plan"}</DialogTitle>
          <DialogDescription>
            La cuota es lo que la planilla descuenta por defecto cada mes desde
            el mes de inicio (solo planes en pesos), hasta completar el total.
            En la planilla se puede cambiar el descuento de un mes.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="plan-description">Descripción</Label>
            <Input
              id="plan-description"
              placeholder="Ej. adelanto de marzo, préstamo para la moto"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="plan-currency">Moneda</Label>
            <Select
              value={currency}
              disabled={plan !== null}
              onValueChange={(v) => {
                if (isAccountCurrency(v)) setCurrency(v);
              }}
            >
              <SelectTrigger id="plan-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="plan-start">Primer mes</Label>
            <Input
              id="plan-start"
              type="month"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="plan-total">Total</Label>
            <MoneyInput
              id="plan-total"
              className="text-right font-mono"
              value={total}
              onChange={setTotal}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="plan-installment">Cuota mensual</Label>
            <MoneyInput
              id="plan-installment"
              className="text-right font-mono"
              value={installment}
              onChange={setInstallment}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="plan-creditor">Acreedor</Label>
            <Select
              value={creditor}
              onValueChange={(v) => {
                if (isCreditor(v)) setCreditor(v);
              }}
            >
              <SelectTrigger id="plan-creditor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREDITORS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CREDITOR_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {creditor === "socio" && (
            <div className="space-y-2">
              <Label htmlFor="plan-creditor-name">Socio</Label>
              <Input
                id="plan-creditor-name"
                value={creditorName}
                onChange={(e) => setCreditorName(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="plan-notes">Notas</Label>
            <Textarea
              id="plan-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
