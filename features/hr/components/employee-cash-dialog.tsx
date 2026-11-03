"use client";

import { HandCoins } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  useDefaultChannel,
  useScope,
} from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";
import { isCheckAccount } from "@/features/accounts/schema";
import { parseArAmount, todayInAR } from "@/lib/format";

import { useRecordAccountCash } from "../hooks/use-employee-account";
import { useEmployeesList } from "../hooks/use-employees";
import type { DebtPlan } from "../account-schema";

type CashKind = "advance" | "payment";

const TITLE: Record<CashKind, string> = {
  advance: "Adelanto a empleado",
  payment: "Pago del empleado",
};

const NONE = "__none__";

/**
 * "Adelanto a empleado" (egreso de caja) or "Pago del empleado" (ingreso): a
 * treasury movement that goes to the employee's current account, not to
 * cost. Opened from Tesorería / Caja (employee picked here) or from the
 * employee's card (fixed). The currency is the account's.
 */
export function EmployeeCashDialog({
  kind,
  employeeId,
  employeeName,
  plans = [],
  trigger,
}: {
  kind: CashKind;
  employeeId?: string;
  employeeName?: string;
  /** The employee's plans, to credit a payment to one. */
  plans?: DebtPlan[];
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <HandCoins className="size-4" />
            {TITLE[kind]}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {TITLE[kind]}
            {employeeName ? ` — ${employeeName}` : ""}
          </DialogTitle>
          <DialogDescription>
            {kind === "advance"
              ? "Sale de la cuenta elegida y va a la cuenta corriente del empleado (no es un gasto). Se descuenta en la planilla con un plan en cuotas."
              : "Entra en la cuenta elegida y baja lo que el empleado debe."}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <Suspense
            fallback={
              <div className="py-6 text-center text-sm text-muted-foreground">
                Cargando…
              </div>
            }
          >
            {employeeId ? (
              <CashForm
                kind={kind}
                employeeId={employeeId}
                plans={plans}
                onDone={() => setOpen(false)}
              />
            ) : (
              <PickEmployeeThenForm kind={kind} onDone={() => setOpen(false)} />
            )}
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickEmployeeThenForm({
  kind,
  onDone,
}: {
  kind: CashKind;
  onDone: () => void;
}) {
  const { data: employees } = useEmployeesList();
  const active = useMemo(
    () => employees.filter((e) => e.is_active),
    [employees],
  );
  const [employeeId, setEmployeeId] = useState("");
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="cash-employee">Empleado</Label>
        <Select value={employeeId} onValueChange={setEmployeeId}>
          <SelectTrigger id="cash-employee">
            <SelectValue placeholder="Elegí el empleado" />
          </SelectTrigger>
          <SelectContent>
            {active.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.legal_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {employeeId ? (
        <CashForm
          key={employeeId}
          kind={kind}
          employeeId={employeeId}
          plans={[]}
          onDone={onDone}
        />
      ) : null}
    </div>
  );
}

function CashForm({
  kind,
  employeeId,
  plans,
  onDone,
}: {
  kind: CashKind;
  employeeId: string;
  plans: DebtPlan[];
  onDone: () => void;
}) {
  const { data: accounts } = useAccountsList();
  const { channels } = useScope();
  const defaultChannel = useDefaultChannel();
  const mutation = useRecordAccountCash(employeeId);

  const usable = useMemo(
    () => accounts.filter((a) => a.is_active && !isCheckAccount(a.type)),
    [accounts],
  );
  const activeChannels = channels.filter((c) => c.is_active);

  const [accountId, setAccountId] = useState(usable[0]?.id ?? "");
  const [channelId, setChannelId] = useState(defaultChannel ?? "");
  const [date, setDate] = useState(todayInAR());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [inInstallments, setInInstallments] = useState(kind === "advance");
  const [installment, setInstallment] = useState("");
  const [planId, setPlanId] = useState(NONE);

  const account = usable.find((a) => a.id === accountId);
  const currency = account?.currency ?? "ARS";
  const plansForPayment = plans.filter(
    (p) => p.currency === currency && p.remaining > 0,
  );

  function parse(v: string): number {
    return parseArAmount(v) ?? Number.NaN;
  }

  function onSave() {
    const value = parse(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Importe inválido.");
      return;
    }
    const installmentValue =
      kind === "advance" && inInstallments
        ? parse(installment || amount)
        : null;
    mutation.mutate(
      {
        employee_id: employeeId,
        kind,
        account_id: accountId,
        channel_id: channelId,
        date,
        amount: value,
        description,
        plan_id: kind === "payment" && planId !== NONE ? planId : null,
        installment_amount: installmentValue,
      },
      {
        onSuccess: () => {
          toast.success(
            kind === "advance" ? "Adelanto registrado." : "Pago registrado.",
          );
          onDone();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  if (usable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay cajas ni bancos activos. Creá o activá una cuenta en Tesorería.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cash-account">Cuenta</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger id="cash-account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {usable.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cash-channel">Canal</Label>
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger id="cash-channel">
              <SelectValue placeholder="Elegí el canal" />
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
        <div className="space-y-2">
          <Label htmlFor="cash-date">Fecha</Label>
          <Input
            id="cash-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cash-amount">Importe ({currency})</Label>
          <Input
            id="cash-amount"
            inputMode="decimal"
            className="text-right font-mono"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="cash-description">Descripción (opcional)</Label>
          <Input
            id="cash-description"
            placeholder={
              kind === "advance" ? "Ej. adelanto de sueldo" : "Ej. devolución"
            }
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {kind === "advance" && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="cash-installments"
              checked={inInstallments}
              onCheckedChange={(v) => setInInstallments(v === true)}
            />
            <Label htmlFor="cash-installments" className="font-normal">
              Descontar en la planilla con un plan
            </Label>
          </div>
          {inInstallments && (
            <div className="space-y-2">
              <Label htmlFor="cash-installment">
                Cuota mensual (vacío = todo en un mes)
              </Label>
              <Input
                id="cash-installment"
                inputMode="decimal"
                className="text-right font-mono"
                value={installment}
                onChange={(e) => setInstallment(e.target.value)}
              />
              {currency !== "ARS" && (
                <p className="text-xs text-muted-foreground">
                  La planilla solo descuenta planes en pesos: uno en dólares se
                  salda con pagos del empleado.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {kind === "payment" && plansForPayment.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="cash-plan">Imputar a un plan (opcional)</Label>
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger id="cash-plan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sin plan</SelectItem>
              {plansForPayment.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={mutation.isPending}
        >
          Cancelar
        </Button>
        <Button
          onClick={onSave}
          disabled={mutation.isPending || !accountId || !channelId}
        >
          {mutation.isPending ? "Guardando…" : "Registrar"}
        </Button>
      </DialogFooter>
    </div>
  );
}
